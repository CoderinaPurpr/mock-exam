export async function onRequestPost(context) {
  try {
    const { DB } = context.env;

    const body = await context.request.json();
    const submission_id = String(body?.submission_id || "");
    const part = Number(body?.part || 0);
    const nonce = String(body?.nonce || "");

    if (!submission_id || !Number.isInteger(part) || part < 1 || part > 4 || !nonce) {
      return new Response(JSON.stringify({ ok: false, error: "Bad request" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Try to lock this part once per submission
    try {
      await DB.prepare(
        "INSERT INTO listening_plays (submission_id, part, nonce) VALUES (?, ?, ?)"
      ).bind(submission_id, part, nonce).run();

      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      // If already locked, allow only if same nonce (same play session)
      const existing = await DB.prepare(
        "SELECT nonce FROM listening_plays WHERE submission_id = ? AND part = ?"
      ).bind(submission_id, part).first();

      if (existing && existing.nonce === nonce) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ ok: false, error: "Already played" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
