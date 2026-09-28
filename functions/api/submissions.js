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
