// Pages keeps the public URL and forwards API traffic through a service binding.
export default {
  async fetch(request, env) {
    if (!new URL(request.url).pathname.startsWith("/api/"))
      return env.ASSETS.fetch(request);
    try {
      const response = await env.API.fetch(request);
      const headers = new Headers(response.headers);
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Referrer-Policy", "no-referrer");
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return Response.json(
        {
          ok: false,
          error: {
            code: "UNAVAILABLE",
            message: "The API is temporarily unavailable. Please retry.",
          },
        },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
  },
};
