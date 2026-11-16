import "server-only";
import { cookies } from "next/headers";

export const API_URL = process.env.API_URL ?? "http://localhost:4000";
export const AT = "bandha_at";
export const RT = "bandha_rt";

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const base = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };

/** Tokens live only in httpOnly cookies, so page JavaScript can never read them. */
export async function setSession(t: Tokens) {
  const jar = await cookies();
  // Access cookie expires slightly early so an expired token is never sent.
  jar.set(AT, t.accessToken, { ...base, maxAge: Math.max(t.expiresIn - 30, 1) });
  jar.set(RT, t.refreshToken, { ...base, maxAge: 30 * 86_400 });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(AT);
  jar.delete(RT);
}

// Parallel requests carrying the same expired session must share ONE refresh. A second refresh with
// the already-rotated token would look like token theft and revoke the whole session family.
const inflight = new Map<string, Promise<Tokens | null>>();

export function refreshTokens(refreshToken: string): Promise<Tokens | null> {
  const existing = inflight.get(refreshToken);
  if (existing) return existing;
  const p = (async () => {
    try {
      const res = await fetch(`${API_URL}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
        cache: "no-store",
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { tokens: Tokens };
      return json.tokens;
    } catch {
      return null;
    }
  })();
  inflight.set(refreshToken, p);
  // Keep the result briefly: requests that left the browser with the old cookie still arrive afterwards.
  setTimeout(() => inflight.delete(refreshToken), 15_000).unref?.();
  return p;
}
