import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { API_URL, AT, RT, clearSession, refreshTokens, setSession, type Tokens } from "@/lib/server/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

const json = (body: unknown, status: number) => NextResponse.json(body, { status });

async function upstream(sub: string, search: string, method: string, body: string | undefined, token: string | null, who: { ua: string | null; ip: string | null }) {
  return fetch(`${API_URL}/api/${sub}${search}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(who.ua ? { "User-Agent": who.ua } : {}),
      // The API rate-limits per client address; without this every web user would share the BFF's address.
      ...(who.ip ? { "X-Forwarded-For": who.ip } : {}),
    },
    body,
    cache: "no-store",
  });
}

/** Backend-for-frontend: the browser talks to /api/*, this adds the Bearer token from httpOnly cookies. */
async function handle(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  const sub = path.join("/");
  const method = req.method;
  const who = { ua: req.headers.get("user-agent"), ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null };
  const body = method === "GET" || method === "HEAD" ? undefined : await req.text();
  const jar = await cookies();

  try {
    // Verifying the emailed code signs the person in, exactly like login does. (Registration answers 202 without tokens until then.)
    if (sub === "auth/login" || sub === "auth/register" || sub === "auth/verify") {
      const res = await upstream(sub, "", method, body, null, who);
      const data = (await res.json().catch(() => ({}))) as { user?: unknown; tokens?: Tokens; error?: string };
      if (!res.ok || !data.tokens) return json(data, res.status);
      await setSession(data.tokens);
      return json({ user: data.user }, res.status);
    }

    if (sub === "auth/logout") {
      const rt = jar.get(RT)?.value;
      if (rt) await upstream("auth/logout", "", "POST", JSON.stringify({ refreshToken: rt }), null, who).catch(() => undefined);
      await clearSession();
      return new Response(null, { status: 204 });
    }

    // Password reset needs no session and sets no cookies: pass the answer straight through.
    if (sub === "auth/forgot" || sub === "auth/reset" || sub === "auth/verify/resend") {
      const res = await upstream(sub, "", method, body, null, who);
      return new Response(res.body, { status: res.status, headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" } });
    }

    if (sub.startsWith("auth/")) return json({ error: "Tidak ditemukan" }, 404);

    let token = jar.get(AT)?.value ?? null;
    const rt = jar.get(RT)?.value ?? null;

    if (!token && rt) {
      const t = await refreshTokens(rt);
      if (!t) { await clearSession(); return json({ error: "Tidak terautentikasi" }, 401); }
      await setSession(t);
      token = t.accessToken;
    }
    if (!token) return json({ error: "Tidak terautentikasi" }, 401);

    let res = await upstream(sub, req.nextUrl.search, method, body, token, who);

    if (res.status === 401 && rt) {
      const t = await refreshTokens(rt);
      if (!t) { await clearSession(); return json({ error: "Tidak terautentikasi" }, 401); }
      await setSession(t);
      res = await upstream(sub, req.nextUrl.search, method, body, t.accessToken, who);
    }

    return new Response(res.status === 204 ? null : res.body, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return json({ error: "Server tidak dapat dihubungi" }, 502);
  }
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
