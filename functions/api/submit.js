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

    const readingJson = JSON.stringify(readingObj);
    const listeningJson = JSON.stringify(listeningObj);
    const writingJson = JSON.stringify(writingObj);
    const speakingMetaJson = JSON.stringify(speakingMetaObj);

    // ---------- Server-side reading scoring (13Q key) ----------
    let readingScore = null;
    let readingTotal = null;
    let readingIncorrectJson = null;

    // Expecting readingObj.answers = { q1: "...", q5: "TRUE", ... }
    const readingAnswers = readingObj?.answers;
    if (readingAnswers && typeof readingAnswers === "object") {
      const scored = scoreReading13(readingAnswers);
      readingScore = scored.score;
      readingTotal = scored.total;
      readingIncorrectJson = JSON.stringify(scored.incorrect);
    } else {
      // If we didn't receive reading this time, keep existing score/incorrect if present
      // (No extra read needed; leaving null will not overwrite due to merge logic below.)
    }

    // ---------- Upsert submission (merge-safe) ----------
    // IMPORTANT: We do not overwrite score fields unless we computed them now.
    const existingScoreRow = await env.DB.prepare(
      `SELECT reading_score, reading_total, reading_incorrect_json FROM submissions WHERE id = ?`
    ).bind(submissionId).first();

    const finalReadingScore = (readingScore !== null) ? readingScore : (existingScoreRow?.reading_score ?? null);
    const finalReadingTotal = (readingTotal !== null) ? readingTotal : (existingScoreRow?.reading_total ?? null);
    const finalIncorrectJson = (readingIncorrectJson !== null) ? readingIncorrectJson : (existingScoreRow?.reading_incorrect_json ?? null);

    await env.DB.prepare(
      `INSERT INTO submissions
        (id, lead_id, user_agent,
         reading_answers_json, listening_answers_json, writing_answers_json, speaking_meta_json,
         reading_score, reading_total, reading_incorrect_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         lead_id = excluded.lead_id,
         user_agent = excluded.user_agent,
         reading_answers_json = excluded.reading_answers_json,
         listening_answers_json = excluded.listening_answers_json,
         writing_answers_json = excluded.writing_answers_json,
         speaking_meta_json = excluded.speaking_meta_json,
         reading_score = excluded.reading_score,
         reading_total = excluded.reading_total,
         reading_incorrect_json = excluded.reading_incorrect_json
      `
    ).bind(
      submissionId, leadId, ua,
      readingJson, listeningJson, writingJson, speakingMetaJson,
      finalReadingScore, finalReadingTotal, finalIncorrectJson
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
      reading_total: finalReadingTotal
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
// Reading key (13 questions)
// ------------------------------
function scoreReading13(a) {
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
    q13: "tsunami"
  };

  const total = 13;
  let score = 0;
  const incorrect = [];

  for (let i = 1; i <= 13; i++) {
    const k = `q${i}`;
    const correct = key[k];

    const yourRaw = a[k];
    const your = (yourRaw ?? "").toString().trim();

    const isWord = [1,2,3,4,8,9,10,11,12,13].includes(i);

    const ok = isWord
      ? normalizeWord(your) === normalizeWord(correct)
      : your === correct;

    if (ok) score++;
    else incorrect.push({ q: i, your, correct });
  }

  return { score, total, incorrect };
}

function normalizeWord(s) {
  return (s || "").toString().trim().toLowerCase();
}
