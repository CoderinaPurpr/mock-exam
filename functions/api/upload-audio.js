// functions/api/upload-audio.js
export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const ct = request.headers.get("Content-Type") || "";
    if (!ct.includes("multipart/form-data")) {
      return json({ ok: false, error: "Expected multipart/form-data." }, 400);
    }

    const form = await request.formData();
    const submissionId = (form.get("submission_id") || "").toString().trim();
    const part = (form.get("part") || "").toString().trim();
    const file = form.get("audio");

    if (!submissionId || !part) return json({ ok: false, error: "Missing submission_id or part." }, 400);
    if (!["part1", "part2", "part3"].includes(part)) return json({ ok: false, error: "Invalid part." }, 400);
    if (!(file instanceof File)) return json({ ok: false, error: "Missing audio file." }, 400);

    const row = await env.DB.prepare(`SELECT speaking_meta_json FROM submissions WHERE id = ?`)
      .bind(submissionId)
      .first();
    if (!row) return json({ ok: false, error: "Submission not found." }, 404);

    let meta = {};
    try { meta = JSON.parse(row.speaking_meta_json || "{}"); } catch { meta = {}; }

    const ext = guessExt(file.type) || "webm";
    const key = `speaking/${submissionId}/${part}.${ext}`;

    const buf = await file.arrayBuffer();
    await env.AUDIO_BUCKET.put(key, buf, {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
    });

    meta[part] = key;

    await env.DB.prepare(`UPDATE submissions SET speaking_meta_json = ? WHERE id = ?`)
      .bind(JSON.stringify(meta), submissionId)
      .run();

    return json({ ok: true, key });
  } catch (err) {
    return json({ ok: false, error: "Server error", detail: String(err) }, 500);
  }
}

function guessExt(mime) {
  if (mime === "audio/webm") return "webm";
  if (mime === "audio/ogg") return "ogg";
  if (mime === "audio/wav") return "wav";
  if (mime === "audio/mpeg") return "mp3";
  return null;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
