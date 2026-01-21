// functions/_middleware.js
export async function onRequest(context) {
  const url = new URL(context.request.url);

  // Only protect admin API routes (student routes remain open)
  if (url.pathname.startsWith("/api/admin/")) {
    const auth = context.request.headers.get("Authorization") || "";
    const expectedUser = context.env.ADMIN_USER || "";
    const expectedPass = context.env.ADMIN_PASS || "";

    if (!expectedUser || !expectedPass) {
      return new Response("Admin auth not configured.", { status: 503 });
    }

    if (!auth.startsWith("Basic ")) {
      return new Response("Unauthorized", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="Admin"' },
      });
    }

    const b64 = auth.slice("Basic ".length).trim();
    let decoded = "";
    try {
      decoded = atob(b64);
    } catch {
      return new Response("Unauthorized", { status: 401 });
    }

    const [user, pass] = decoded.split(":");
    if (user !== expectedUser || pass !== expectedPass) {
      return new Response("Unauthorized", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="Admin"' },
      });
    }
  }

  return context.next();
}
