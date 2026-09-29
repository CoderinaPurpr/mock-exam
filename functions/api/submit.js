// functions/api/submit.js
export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const data = await request.json();

    const name = (data?.lead?.name || "").trim();
    const email = (data?.lead?.email || "").trim();
    const whatsapp = (data?.lead?.whatsapp || "").trim();
    const consent = data?.lead?.consent ? 1 : 0;

    if (!name || !email) return json({ ok: false, error: "Name and Email are required." }, 400);
    if (!consent) return json({ ok: false, error: "Consent is required." }, 400);

    const submissionId = (data?.submission_id || "").trim();
    if (!submissionId) return json({ ok: false, error: "Missing submission_id." }, 400);

    const ua = request.headers.get("User-Agent") || null;

    // ---------- Lead: find or create (by email) ----------
    const existingLead = await env.DB.prepare(
      `SELECT id FROM leads WHERE email = ? ORDER BY id DESC LIMIT 1`
    ).bind(email).first();

    let leadId = existingLead?.id || null;

    if (!leadId) {
      const leadRes = await env.DB.prepare(
        `INSERT INTO leads (name, email, whatsapp, consent) VALUES (?, ?, ?, ?)`
      ).bind(name, email, whatsapp || null, consent).run();

      leadId = leadRes.meta?.last_row_id;
    } else {
      await env.DB.prepare(
        `UPDATE leads SET name = ?, whatsapp = ?, consent = ? WHERE id = ?`
      ).bind(name, whatsapp || null, consent, leadId).run();
    }

    // ---------- Load existing submission so we can PATCH/merge ----------
    const existing = await env.DB.prepare(
      `SELECT reading_answers_json, listening_answers_json, writing_answers_json, speaking_meta_json
       FROM submissions WHERE id = ?`
    ).bind(submissionId).first();

    const incomingReading = data?.answers?.reading;
    const incomingListening = data?.answers?.listening;
    const incomingWriting = data?.answers?.writing;
    const incomingSpeaking = data?.answers?.speaking;

    // Only overwrite a section if the client actually sent it (and it isn't empty)
    const readingObj = hasContent(incomingReading)
      ? incomingReading
      : safeParse(existing?.reading_answers_json, {});

    const listeningObj = hasContent(incomingListening)
      ? incomingListening
      : safeParse(existing?.listening_answers_json, {});

    const writingObj = hasContent(incomingWriting)
      ? incomingWriting
      : safeParse(existing?.writing_answers_json, {});

    const speakingMetaObj = hasContent(incomingSpeaking)
      ? incomingSpeaking
      : safeParse(existing?.speaking_meta_json, { part1: null, part2: null, part3: null });

    // ---------- AI Writing assessment ----------
    let writingTask1AssessmentJson = null;
    let writingTask2AssessmentJson = null;

    if (hasContent(incomingWriting) && writingObj?.completed) {
      const task1 = writingObj.task1;
      const task2 = writingObj.task2;

      if (task1?.prompt && task1?.answer?.trim()) {
        try {
          const assessment = await evaluateWritingWithAI(
            "task1",
            task1.prompt,
            task1.answer,
            env
          );

          writingTask1AssessmentJson = JSON.stringify(assessment);
        } catch (error) {
          console.error("Task 1 AI assessment failed:", error);
        }
      }

      if (task2?.prompt && task2?.answer?.trim()) {
        try {
          const assessment = await evaluateWritingWithAI(
            "task2",
            task2.prompt,
            task2.answer,
            env
          );

          writingTask2AssessmentJson = JSON.stringify(assessment);
        } catch (error) {
          console.error("Task 2 AI assessment failed:", error);
        }
      }
    }

    const readingJson = JSON.stringify(readingObj);
    const listeningJson = JSON.stringify(listeningObj);
    const writingJson = JSON.stringify(writingObj);
    const speakingMetaJson = JSON.stringify(speakingMetaObj);

    // ---------- Server-side Reading scoring (40 questions) ----------
    let readingScore = null;
    let readingTotal = null;
    let readingIncorrectJson = null;

// Current Reading format stores answers inside passages.
  const readingAnswers = {};

  if (readingObj?.passages && typeof readingObj.passages === "object") {
    for (const passage of Object.values(readingObj.passages)) {
      if (passage?.answers && typeof passage.answers === "object") {
        Object.assign(readingAnswers, passage.answers);
      }
    }
  }

  if (Object.keys(readingAnswers).length > 0) {
    const scored = scoreReading40(readingAnswers);
    readingScore = scored.score;
    readingTotal = scored.total;
    readingIncorrectJson = JSON.stringify(scored.incorrect);
  }

    // ---------- Server-side Listening scoring (40 questions) ----------
    let listeningScore = null;
    let listeningTotal = null;
    let listeningIncorrectJson = null;

    const listeningAnswers = {};

    if (listeningObj?.sections && typeof listeningObj.sections === "object") {
      for (const section of Object.values(listeningObj.sections)) {
        if (section?.answers && typeof section.answers === "object") {
          Object.assign(listeningAnswers, section.answers);
        }
      }
    }

    if (Object.keys(listeningAnswers).length > 0) {
      const scored = scoreListening40(listeningAnswers);
      listeningScore = scored.score;
      listeningTotal = scored.total;
      listeningIncorrectJson = JSON.stringify(scored.incorrect);
    }

    // ---------- Upsert submission (merge-safe) ----------
    // IMPORTANT: We do not overwrite score fields unless we computed them now.
    const existingScoreRow = await env.DB.prepare(
      `SELECT
        reading_score,
        reading_total,
        reading_incorrect_json,
        listening_score,
        listening_total,
        listening_incorrect_json,
        writing_task1_assessment_json,
        writing_task2_assessment_json
      FROM submissions
      WHERE id = ?`
    ).bind(submissionId).first();

    const finalReadingScore = (readingScore !== null) ? readingScore : (existingScoreRow?.reading_score ?? null);
    const finalReadingTotal = (readingTotal !== null) ? readingTotal : (existingScoreRow?.reading_total ?? null);
    const finalIncorrectJson = (readingIncorrectJson !== null) ? readingIncorrectJson : (existingScoreRow?.reading_incorrect_json ?? null);
    const finalListeningScore = (listeningScore !== null) ? listeningScore : (existingScoreRow?.listening_score ?? null);
    const finalListeningTotal = (listeningTotal !== null) ? listeningTotal : (existingScoreRow?.listening_total ?? null);
    const finalListeningIncorrectJson = (listeningIncorrectJson !== null) ? listeningIncorrectJson : (existingScoreRow?.listening_incorrect_json ?? null);

    const finalWritingTask1AssessmentJson =
      (writingTask1AssessmentJson !== null)
        ? writingTask1AssessmentJson
        : (existingScoreRow?.writing_task1_assessment_json ?? null);

    const finalWritingTask2AssessmentJson =
      (writingTask2AssessmentJson !== null)
        ? writingTask2AssessmentJson
        : (existingScoreRow?.writing_task2_assessment_json ?? null);

    await env.DB.prepare(
      `INSERT INTO submissions
        (id, lead_id, user_agent,
         reading_answers_json, listening_answers_json, writing_answers_json, speaking_meta_json,
         reading_score, reading_total, reading_incorrect_json,
         listening_score, listening_total, listening_incorrect_json,
         writing_task1_assessment_json, writing_task2_assessment_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         lead_id = excluded.lead_id,
         user_agent = excluded.user_agent,
         reading_answers_json = excluded.reading_answers_json,
         listening_answers_json = excluded.listening_answers_json,
         writing_answers_json = excluded.writing_answers_json,
         speaking_meta_json = excluded.speaking_meta_json,
         reading_score = excluded.reading_score,
         reading_total = excluded.reading_total,
         reading_incorrect_json = excluded.reading_incorrect_json,
         listening_score = excluded.listening_score,
         listening_total = excluded.listening_total,
         listening_incorrect_json = excluded.listening_incorrect_json,
         writing_task1_assessment_json = excluded.writing_task1_assessment_json,
         writing_task2_assessment_json = excluded.writing_task2_assessment_json
      `
    ).bind(
      submissionId, leadId, ua,
      readingJson, listeningJson, writingJson, speakingMetaJson,
      finalReadingScore, finalReadingTotal, finalIncorrectJson,
      finalListeningScore, finalListeningTotal, finalListeningIncorrectJson,
      finalWritingTask1AssessmentJson, finalWritingTask2AssessmentJson
    ).run();

    // ---------- History / audit ----------
    await env.DB.prepare(
      `INSERT INTO submission_events (submission_id, event_type, payload_json)
       VALUES (?, ?, ?)`
    ).bind(
      submissionId,
      "section_submit",
      JSON.stringify({
        has_reading: !!incomingReading,
        has_listening: !!incomingListening,
        has_writing: !!incomingWriting,
        has_speaking: !!incomingSpeaking
      })
    ).run();

    return json({
      ok: true,
      submission_id: submissionId,
      reading_score: finalReadingScore,
      reading_total: finalReadingTotal,
      listening_score: finalListeningScore,
      listening_total: finalListeningTotal
    });
  } catch (err) {
    return json({ ok: false, error: "Server error", detail: String(err) }, 500);
  }
}

// ------------------------------
// Helpers
// ------------------------------
function hasContent(obj) {
  return obj && typeof obj === "object" && Object.keys(obj).length > 0;
}

function safeParse(s, fallback) {
  try {
    if (!s) return fallback;
    const v = JSON.parse(s);
    return (v && typeof v === "object") ? v : fallback;
  } catch {
    return fallback;
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ------------------------------
// Reading key (40 questions)
// ------------------------------
function scoreReading40(a) {
  const key = {
    q1: "oval",
    q2: "husk",
    q3: "seed",
    q4: "mace",
    q5: "FALSE",
    q6: "NOT GIVEN",
    q7: "TRUE",
    q8: "Arabs",
    q9: "plague",
    q10: "lime",
    q11: "Run",
    q12: "Mauritius",
    q13: "tsunami",
    q14: "C",
    q15: "B",
    q16: "E",
    q17: "G",
    q18: "D",
    q19: "human error",
    q20: ["car sharing", "car-sharing"],
    q21: "ownership",
    q22: "mileage",
    q27: "A",
    q28: "C",
    q29: "C",
    q30: "D",
    q31: "A",
    q32: "B",
    q33: "E",
    q34: "A",
    q35: "D",
    q36: "E",
    q37: "B",
    q38: ["expeditions", "unique expeditions"],
    q39: ["uncontacted", "isolated"],
    q40: ["surface", "land surface"]
  };

  const total = 40;
  let score = 0;
  const incorrect = [];

  function matches(yourRaw, accepted) {
    const your = normalizeWord((yourRaw ?? "").toString());

    const answers = Array.isArray(accepted) ? accepted : [accepted];
    return answers.some(answer => your === normalizeWord(answer));
  }

  // Questions 1–22
  for (let i = 1; i <= 22; i++) {
    const k = `q${i}`;
    const your = (a[k] ?? "").toString().trim();
    const correct = key[k];

    if (matches(your, correct)) {
      score++;
    } else {
      incorrect.push({ q: i, your, correct });
    }
  }

  // Questions 23–24: C and D in either order
  scoreEitherOrderPair(a, 23, 24, ["C", "D"]);

  // Questions 25–26: A and E in either order
  scoreEitherOrderPair(a, 25, 26, ["A", "E"]);

  // Questions 27–40
  for (let i = 27; i <= 40; i++) {
    const k = `q${i}`;
    const your = (a[k] ?? "").toString().trim();
    const correct = key[k];

    if (matches(your, correct)) {
      score++;
    } else {
      incorrect.push({ q: i, your, correct });
    }
  }

  function scoreEitherOrderPair(a, q1, q2, correctAnswers) {
    const yourAnswers = [
      (a[`q${q1}`] ?? "").toString().trim().toUpperCase(),
      (a[`q${q2}`] ?? "").toString().trim().toUpperCase()
    ];

    const remaining = correctAnswers.map(x => x.toUpperCase());

    for (let index = 0; index < yourAnswers.length; index++) {
      const your = yourAnswers[index];
      const matchIndex = remaining.indexOf(your);

      if (matchIndex !== -1) {
        score++;
        remaining.splice(matchIndex, 1);
      } else {
        incorrect.push({
          q: index === 0 ? q1 : q2,
          your,
          correct: `${correctAnswers.join(" / ")} (either order)`
        });
      }
    }
  }

  return { score, total, incorrect };
}

// ------------------------------
// Listening key (40 questions)
// ------------------------------
function scoreListening40(a) {
  const key = {
    q1: "Canadian",
    q2: "furniture",
    q3: "Park",
    q4: ["250", "250 sterling"],
    q5: "phone",
    q6: ["10 September", "10th September"],
    q7: "museum",
    q8: "time",
    q9: ["blond", "blonde"],
    q10: "8795482361",

    q15: "B",
    q16: "B",
    q17: "C",
    q18: "A",
    q19: "A",
    q20: "C",

    q21: "B",
    q22: "A",
    q23: "C",
    q24: "B",
    q25: "A",
    q26: "B",
    q27: "A",
    q28: "F",
    q29: "G",
    q30: "C",

    q31: "industry",
    q32: "constant",
    q33: "direction",
    q34: "floor",
    q35: "predictable",
    q36: "bay",
    q37: "gates",
    q38: "fuel",
    q39: "jobs",
    q40: "migration"
  };

  const total = 40;
  let score = 0;
  const incorrect = [];

  function matches(yourRaw, accepted, questionNumber) {
    let your = (yourRaw ?? "").toString().trim();

    // Q10 is a phone number: ignore spaces.
    if (questionNumber === 10) {
      your = your.replace(/\s+/g, "");
    } else {
      your = normalizeWord(your);
    }

    const answers = Array.isArray(accepted) ? accepted : [accepted];

    return answers.some(answer => {
      let correct = answer.toString();

      if (questionNumber === 10) {
        correct = correct.replace(/\s+/g, "");
        return your === correct;
      }

      return your === normalizeWord(correct);
    });
  }

  function scoreQuestion(q) {
    const your = (a[`q${q}`] ?? "").toString().trim();
    const correct = key[`q${q}`];

    if (matches(your, correct, q)) {
      score++;
    } else {
      incorrect.push({ q, your, correct });
    }
  }

  function scoreEitherOrderPair(q1, q2, correctAnswers) {
    const yourAnswers = [
      (a[`q${q1}`] ?? "").toString().trim().toUpperCase(),
      (a[`q${q2}`] ?? "").toString().trim().toUpperCase()
    ];

    const remaining = correctAnswers.map(x => x.toUpperCase());

    for (let index = 0; index < yourAnswers.length; index++) {
      const your = yourAnswers[index];
      const matchIndex = remaining.indexOf(your);

      if (matchIndex !== -1) {
        score++;
        remaining.splice(matchIndex, 1);
      } else {
        incorrect.push({
          q: index === 0 ? q1 : q2,
          your,
          correct: `${correctAnswers.join(" / ")} (either order)`
        });
      }
    }
  }

  // Questions 1–10
  for (let q = 1; q <= 10; q++) {
    scoreQuestion(q);
  }

  // Questions 11–12: A and C in either order
  scoreEitherOrderPair(11, 12, ["A", "C"]);

  // Questions 13–14: B and E in either order
  scoreEitherOrderPair(13, 14, ["B", "E"]);

  // Questions 15–40
  for (let q = 15; q <= 40; q++) {
    scoreQuestion(q);
  }

  return { score, total, incorrect };
}


function normalizeWord(s) {
  return (s || "").toString().trim().toLowerCase();
}

async function evaluateWritingWithAI(taskType, question, essay, env) {
  const taskLabel = taskType === "task1"
    ? "Task Achievement"
    : "Task Response";

  const wordCount = essay
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;

  const prompt = `
You are an IELTS Writing examiner.

Evaluate the candidate's writing based on IELTS Writing criteria.

Task Type: ${taskType === "task1" ? "Task 1" : "Task 2"}

Question:
"${question}"

Candidate Response:
"${essay}"

Word count: ${wordCount}

Use IELTS Writing band descriptors (0-9).

For Task 1, use:
- Task Achievement
- Coherence & Cohesion
- Lexical Resource
- Grammatical Range & Accuracy

For Task 2, use:
- Task Response
- Coherence & Cohesion
- Lexical Resource
- Grammatical Range & Accuracy

Return ONLY valid JSON in this exact format:
{
  "overallBand": 6.5,
  "taskLabel": "${taskLabel}",
  "taskScore": 6.5,
  "coherence": 6.5,
  "vocabulary": 6.5,
  "grammar": 6.5,
  "summary": "Short overall comment",
  "taskComment": "Detailed feedback on task fulfilment",
  "coherenceComment": "Detailed feedback on organization and cohesion",
  "vocabComment": "Detailed feedback on vocabulary",
  "grammarComment": "Detailed feedback on grammar",
  "vocabRepetition": ["word1", "word2"],
  "vocabLevel": "B2"
}

Rules:
- Score each criterion independently. Do not give identical scores across all four criteria unless the response genuinely performs at the same band in all four areas.
- Use 0.5 band increments only.
- Do not assume competent writing is Band 7. Band 7 requires consistently strong performance, not merely clear or understandable writing.
- A response with noticeable repetition, limited development, mechanical cohesion, simple vocabulary, or recurring grammar errors will usually fall below Band 7.
- Band 6 may still contain a clear position and relevant ideas, but development, cohesion, vocabulary range, or grammar control may be uneven.
- Band 5 should be used when ideas are only partly developed, organisation is limited, vocabulary is repetitive or basic, or grammatical errors are frequent.
- Penalise under-length responses and incomplete task coverage.
- For Task 1, check whether there is a clear overview and whether the main features and comparisons are appropriately selected.
- For Task 2, check whether all parts of the prompt are addressed, the position is clear, and ideas are sufficiently developed and supported.
- Judge vocabulary by range, precision, collocation and repetition, not by occasional advanced words.
- Judge grammar by both range and accuracy. Complex sentences should not receive high credit if they contain frequent errors.
- Base every score on evidence in the candidate response. Do not award a higher band simply because the essay is fluent or easy to read.
- Give IELTS-style practical feedback with maximum 3 example sentences.
`;

  const response = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a fair IELTS Writing evaluator. Return only valid JSON."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.1
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`OpenAI Writing evaluation failed: ${JSON.stringify(data)}`);
  }

  const assessment = JSON.parse(data.choices[0].message.content);

  const criterionFields = [
    "taskScore",
    "coherence",
    "vocabulary",
    "grammar"
  ];

  for (const field of criterionFields) {
    if (typeof assessment[field] === "number") {
      assessment[field] = Math.max(
        0,
        Math.min(9, Math.round(assessment[field] * 2) / 2)
      );
    }
  }

  if (criterionFields.every(field => typeof assessment[field] === "number")) {
    const average =
      criterionFields.reduce((sum, field) => sum + assessment[field], 0) /
      criterionFields.length;

    assessment.overallBand = Math.round(average * 2) / 2;
  }

  return assessment;
}
