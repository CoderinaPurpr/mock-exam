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

    // 1) Find or create lead (by email)
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
      // Keep lead details fresh (optional but useful)
      await env.DB.prepare(
        `UPDATE leads SET name = ?, whatsapp = ?, consent = ? WHERE id = ?`
      ).bind(name, whatsapp || null, consent, leadId).run();
    }

    // 2) Prepare JSON blobs
    const reading = JSON.stringify(data?.answers?.reading || {});
    const listening = JSON.stringify(data?.answers?.listening || {});
    const writing = JSON.stringify(data?.answers?.writing || {});

    // Keep existing speaking_meta if present, else set empty structure
    const existingSub = await env.DB.prepare(
      `SELECT speaking_meta_json FROM submissions WHERE id = ?`
    ).bind(submissionId).first();

    const speakingMeta = existingSub?.speaking_meta_json || JSON.stringify({ part1: null, part2: null, part3: null });

    // 3) Upsert submission: insert OR update
    await env.DB.prepare(
      `INSERT INTO submissions
        (id, lead_id, user_agent, reading_answers_json, listening_answers_json, writing_answers_json, speaking_meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         lead_id = excluded.lead_id,
         user_agent = excluded.user_agent,
         reading_answers_json = excluded.reading_answers_json,
         listening_answers_json = excluded.listening_answers_json,
         writing_answers_json = excluded.writing_answers_json
      `
    ).bind(submissionId, leadId, ua, reading, listening, writing, speakingMeta).run();

    return json({ ok: true, submission_id: submissionId });
  } catch (err) {
    return json({ ok: false, error: "Server error", detail: String(err) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
