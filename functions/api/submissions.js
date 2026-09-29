export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const submissionId = url.searchParams.get("id");

    if (!submissionId) {
      const result = await env.DB.prepare(
        `SELECT
          s.id,
          s.created_at,
          s.status,
          s.reading_score,
          s.reading_total,
          s.listening_score,
          s.listening_total,
          l.name,
          l.email
        FROM submissions s
        JOIN leads l ON l.id = s.lead_id
        ORDER BY s.created_at DESC`
      ).all();

      return json({
        ok: true,
        submissions: result.results || []
      });
    }

    const row = await env.DB.prepare(
      `SELECT
         s.id,
         s.created_at,
         s.status,
         s.examiner_note,
         s.examiner_reading_band,
         s.examiner_listening_band,
         s.examiner_writing_task1_band,
         s.examiner_writing_task2_band,
         s.examiner_writing_band,
         s.reviewed_at,

         s.reading_answers_json,
         s.reading_score,
         s.reading_total,
         s.reading_incorrect_json,

         s.listening_answers_json,
         s.listening_score,
         s.listening_total,
         s.listening_incorrect_json,

         s.writing_answers_json,
         s.writing_task1_assessment_json,
        s.writing_task2_assessment_json,

         l.name,
         l.email,
         l.whatsapp

       FROM submissions s
       JOIN leads l ON l.id = s.lead_id
       WHERE s.id = ?`
    ).bind(submissionId).first();

    if (!row) {
      return json({ ok: false, error: "Submission not found" }, 404);
    }

    return json({
      ok: true,
      submission: {
        id: row.id,
        created_at: row.created_at,
        status: row.status,
        examiner_note: row.examiner_note,

        examiner: {
          reading_band: row.examiner_reading_band,
          listening_band: row.examiner_listening_band,
          writing_task1_band: row.examiner_writing_task1_band,
          writing_task2_band: row.examiner_writing_task2_band,
          writing_band: row.examiner_writing_band,
          reviewed_at: row.reviewed_at
        },

        candidate: {
          name: row.name,
          email: row.email,
          whatsapp: row.whatsapp
        },

        reading: {
          score: row.reading_score,
          total: row.reading_total,
          answers: safeParse(row.reading_answers_json),
          incorrect: safeParse(row.reading_incorrect_json)
        },

        listening: {
          score: row.listening_score,
          total: row.listening_total,
          answers: safeParse(row.listening_answers_json),
          incorrect: safeParse(row.listening_incorrect_json)
        },

        writing: {
          answers: safeParse(row.writing_answers_json),
          task1_assessment: safeParse(row.writing_task1_assessment_json),
          task2_assessment: safeParse(row.writing_task2_assessment_json)
        }
      }
    });
  } catch (err) {
    return json(
      { ok: false, error: "Server error", detail: String(err) },
      500
    );
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();

    const submissionId = String(body.id || "").trim();

    if (!submissionId) {
      return json({ ok: false, error: "Submission ID is required" }, 400);
    }

    const readingBand = parseBand(body.reading_band);
    const listeningBand = parseBand(body.listening_band);
    const writingTask1Band = parseBand(body.writing_task1_band);
    const writingTask2Band = parseBand(body.writing_task2_band);
    const writingBand = parseBand(body.writing_band);

    const bands = [
      readingBand,
      listeningBand,
      writingTask1Band,
      writingTask2Band,
      writingBand
    ];

    if (bands.includes("invalid")) {
      return json(
        { ok: false, error: "Bands must be between 0 and 9 in 0.5 increments" },
        400
      );
    }

    const examinerNote =
      typeof body.examiner_note === "string"
        ? body.examiner_note.trim()
        : null;

    const result = await env.DB.prepare(
      `UPDATE submissions
       SET examiner_note = ?,
           examiner_reading_band = ?,
           examiner_listening_band = ?,
           examiner_writing_task1_band = ?,
           examiner_writing_task2_band = ?,
           examiner_writing_band = ?,
           reviewed_at = datetime('now'),
           status = 'reviewed'
       WHERE id = ?`
    )
      .bind(
        examinerNote || null,
        readingBand,
        listeningBand,
        writingTask1Band,
        writingTask2Band,
        writingBand,
        submissionId
      )
      .run();

    if (!result.meta?.changes) {
      return json({ ok: false, error: "Submission not found" }, 404);
    }

    return json({ ok: true });
  } catch (err) {
    return json(
      { ok: false, error: "Server error", detail: String(err) },
      500
    );
  }
}

function parseBand(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const band = Number(value);

  if (
    !Number.isFinite(band) ||
    band < 0 ||
    band > 9 ||
    Math.round(band * 2) !== band * 2
  ) {
    return "invalid";
  }

  return band;
}

function safeParse(value) {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
