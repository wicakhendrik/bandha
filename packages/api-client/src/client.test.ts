import { describe, expect, it, vi } from "vitest";
import { ApiError, createClient, type TokenStorage, type Tokens } from "./client";

const tok = (n: number, expiresIn = 900): Tokens => ({ accessToken: `at${n}`, refreshToken: `rt${n}`, expiresIn });
const res = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status });

function memory(initial: Tokens | null = null): TokenStorage & { value: Tokens | null } {
  const s = { value: initial, load: async () => s.value, save: async (t: Tokens | null) => { s.value = t; } };
  return s;
}

function setup(initial: Tokens | null, handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ path: string; auth: string | null; body: unknown }> = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url).replace("http://api.test/api", "");
    calls.push({ path: u, auth: new Headers(init?.headers).get("authorization"), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return handler(u, init ?? {});
  }) as unknown as typeof fetch;
  const storage = memory(initial);
  const signedOut = vi.fn();
  const client = createClient({ baseUrl: "http://api.test", storage, fetch: fetchFn, onSignedOut: signedOut });
  return { client, storage, calls, signedOut };
}

describe("auth", () => {
  it("login stores tokens and later requests send the bearer token", async () => {
    const { client, storage, calls } = setup(null, (u) => (u === "/auth/login" ? res({ user: { id: "u", name: "A", email: "a@b.c" }, tokens: tok(1) }) : res({ ok: 1 })));
    const user = await client.login({ email: "a@b.c", password: "x" });
    expect(user.name).toBe("A");
    expect(storage.value).toEqual(tok(1));
    await client.request("/me");
    expect(calls.at(-1)?.auth).toBe("Bearer at1");
  });

  it("request without a session fails with 401 and never hits the network", async () => {
    const { client, calls } = setup(null, () => res({}));
    await expect(client.request("/me")).rejects.toMatchObject({ status: 401 });
    expect(calls.length).toBe(0);
  });

  it("logout revokes server side and clears storage", async () => {
    const { client, storage, calls } = setup(tok(1), () => res(null, 204));
    await client.logout();
    expect(calls[0]).toMatchObject({ path: "/auth/logout", body: { refreshToken: "rt1" } });
    expect(storage.value).toBeNull();
    expect(await client.hasSession()).toBe(false);
  });

  it("surfaces validation issues from the API", async () => {
    const { client } = setup(null, () => res({ error: "Input tidak valid", issues: [{ path: "password", message: "Minimal 10 karakter" }] }, 400));
    const err = await client.register({ name: "A", email: "a@b.c", password: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.issues[0].path).toBe("password");
  });
});

describe("refresh", () => {
  it("a 401 triggers one refresh and a retry with the new token", async () => {
    const { client, storage, calls } = setup(tok(1), (u, init) => {
      if (u === "/auth/refresh") return res({ tokens: tok(2) });
      return new Headers(init.headers).get("authorization") === "Bearer at2" ? res({ ok: true }) : res({ error: "x" }, 401);
    });
    expect(await client.request("/accounts")).toEqual({ ok: true });
    expect(storage.value).toEqual(tok(2));
    expect(calls.map((c) => c.path)).toEqual(["/accounts", "/auth/refresh", "/accounts"]);
  });

  it("parallel requests share a single refresh (no token-reuse revocation)", async () => {
    let refreshes = 0;
    const { client } = setup(tok(1, 0), async (u) => {
      if (u === "/auth/refresh") { refreshes++; await new Promise((r) => setTimeout(r, 20)); return res({ tokens: tok(2) }); }
      return res({ ok: true });
    });
    await Promise.all([client.request("/a"), client.request("/b"), client.request("/c"), client.request("/d")]);
    expect(refreshes).toBe(1);
  });

  it("refreshes ahead of time when the access token is about to expire", async () => {
    const { client, calls } = setup(tok(1, 10), (u) => (u === "/auth/refresh" ? res({ tokens: tok(2) }) : res({})));
    await client.request("/me");
    expect(calls.map((c) => c.path)).toEqual(["/auth/refresh", "/me"]);
    expect(calls[1]?.auth).toBe("Bearer at2");
  });

  it("a rejected refresh token ends the session", async () => {
    const { client, storage, signedOut } = setup(tok(1), (u) => (u === "/auth/refresh" ? res({ error: "Sesi tidak valid" }, 401) : res({ error: "x" }, 401)));
    await expect(client.request("/me")).rejects.toMatchObject({ status: 401 });
    expect(storage.value).toBeNull();
    expect(signedOut).toHaveBeenCalledTimes(1);
  });

  it("an offline refresh keeps the session instead of logging the user out", async () => {
    const { client, storage, signedOut } = setup(tok(1), (u) => {
      if (u === "/auth/refresh") throw new TypeError("network down");
      return res({ error: "x" }, 401);
    });
    await expect(client.request("/me")).rejects.toBeInstanceOf(ApiError);
    expect(storage.value).toEqual(tok(1));
    expect(signedOut).not.toHaveBeenCalled();
  });

  it("network failures become a friendly ApiError with status 0", async () => {
    const { client } = setup(tok(1), () => { throw new TypeError("fetch failed"); });
    await expect(client.request("/me")).rejects.toMatchObject({ status: 0 });
  });
});
