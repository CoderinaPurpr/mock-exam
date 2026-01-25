function parseRange(rangeHeader, size) {
  // Example: "bytes=0-1023"
  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) return null;

  const spec = rangeHeader.slice("bytes=".length).trim();
  const [startStr, endStr] = spec.split("-");
  let start = startStr ? parseInt(startStr, 10) : NaN;
  let end = endStr ? parseInt(endStr, 10) : NaN;

  if (Number.isNaN(start)) {
    // suffix range: bytes=-500 (last 500 bytes)
    const suffixLen = Number.isNaN(end) ? 0 : end;
    if (!suffixLen) return null;
    start = Math.max(0, size - suffixLen);
    end = size - 1;
  } else {
    if (Number.isNaN(end) || end >= size) end = size - 1;
  }

  if (start < 0 || end < start || start >= size) return null;
  return { start, end };
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const submission_id = url.searchParams.get("submission_id") || "";
    const part = Number(url.searchParams.get("part") || "0");
    const nonce = url.searchParams.get("nonce") || "";

    if (!submission_id || !Number.isInteger(part) || part < 1 || part > 4 || !nonce) {
      return new Response("Bad request", { status: 400 });
    }

    const { DB, AUDIO_BUCKET } = context.env;

    // Verify one-time lock + same nonce
    const row = await DB.prepare(
      "SELECT nonce FROM listening_plays WHERE submission_id = ? AND part = ?"
    ).bind(submission_id, part).first();

    if (!row || row.nonce !== nonce) {
      return new Response("Forbidden", { status: 403 });
    }

    // Map parts -> R2 keys (your filenames)
    const keyMap = {
      1: "l1.mp3",
      2: "l2.mp3",
      3: "l3.mp3",
      4: "l4.mp3",
    };
    const key = keyMap[part];

    const obj = await AUDIO_BUCKET.get(key);
    if (!obj) return new Response("Not found", { status: 404 });

    const size = obj.size;
    const rangeHeader = context.request.headers.get("Range");
    const range = parseRange(rangeHeader, size);

    // If client asks for ranges (common for <audio>), support it.
    if (range) {
      const offset = range.start;
      const length = range.end - range.start + 1;

      const partial = await AUDIO_BUCKET.get(key, { range: { offset, length } });
      if (!partial) return new Response("Not found", { status: 404 });

      return new Response(partial.body, {
        status: 206,
        headers: {
          "Content-Type": "audio/mpeg",
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
          "Content-Length": String(length),
          "Cache-Control": "no-store",
        },
      });
    }

    // Full response
    return new Response(obj.body, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Accept-Ranges": "bytes",
        "Content-Length": String(size),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return new Response("Server error", { status: 500 });
  }
}
