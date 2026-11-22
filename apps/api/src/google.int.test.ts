import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { users } from "@bandha/db";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { HttpError } from "./errors";
import type { GoogleProfile } from "./google";
import type { MailMessage } from "./mailer";
import { db, pool, services } from "./test-utils";

afterAll(async () => { await pool.end(); });

/** Stands in for Google: "tok:<sub>:<email>" is a valid token for that person, anything else is rejected the way a bad token is. */
const verifier = {
  async verify(idToken: string): Promise<GoogleProfile> {
    const m = idToken.match(/^tok:([^:]+):(.+)$/);
    if (!m) throw new HttpError(401, "Login Google tidak valid. Coba lagi.", { code: "google_invalid" });
    return { sub: m[1]!, email: m[2]!, name: "Nama Google" };
  },
};
const sent: MailMessage[] = [];
const config = (otp: string) => loadConfig({ DATABASE_URL: "x", JWT_SECRET: "t".repeat(40), MARKET_PROVIDER: "fake", REQUIRE_EMAIL_OTP: otp });
const mailer = { send: async (m: MailMessage) => { sent.push(m); } };
// Registration with the emailed code ON, because that is where an unconfirmed account can exist.
const app = createApp({ db, config: config("true"), services, mailer, googleVerifier: verifier });
const appWithoutGoogle = createApp({ db, config: config("true"), services, mailer });

const ip = () => ({ "x-forwarded-for": `10.3.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
async function post(path: string, body: unknown, a = app) {
  const res = await a.request(`/api${path}`, { method: "POST", headers: { "content-type": "application/json", ...ip() }, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}
async function get(path: string, token: string) {
  const res = await app.request(`/api${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, json: await res.json() };
}

const PASSWORD = "password-panjang-1";
const fresh = () => `g-${randomUUID()}@test.dev`;
const google = (sub: string, email: string) => post("/auth/google", { idToken: `tok:${sub}:${email}` });
const code = (email: string) => sent.filter((x) => x.to === email).at(-1)!.text.match(/Kode verifikasi Bandha Anda: (\d{6})/)![1]!;

describe("sign in with Google", () => {
  it("creates a verified account with its own ledger on the first sign-in, and signs the same person in afterwards", async () => {
    const email = fresh();
    const sub = randomUUID();
    const first = await google(sub, email);
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ created: true, user: { email, name: "Nama Google" } });
    expect((await get("/me", first.json.tokens.accessToken)).json).toMatchObject({ user: { email }, role: "user" });

    const [row] = await db.select().from(users).where(eq(users.email, email));
    expect(row).toMatchObject({ googleSub: sub });
    expect(row!.emailVerifiedAt).not.toBeNull();

    const again = await google(sub, email);
    expect(again.json).toMatchObject({ created: false, user: { id: first.json.user.id } });
  });

  it("keeps recognising the person by their Google id even if the address on the Google account changed", async () => {
    const sub = randomUUID();
    const first = await google(sub, fresh());
    const again = await google(sub, fresh());
    expect(again.json).toMatchObject({ created: false, user: { id: first.json.user.id } });
  });

  it("links Google to an existing confirmed account, which keeps working with its password", async () => {
    const email = fresh();
    await post("/auth/register", { name: "Budi", email, password: PASSWORD });
    await post("/auth/verify", { email, code: code(email) });

    const g = await google(randomUUID(), email);
    expect(g.json).toMatchObject({ created: false, user: { email, name: "Budi" } });
    expect((await post("/auth/login", { email, password: PASSWORD })).status).toBe(200);
  });

  it("matches the address regardless of letter case", async () => {
    const email = fresh();
    await post("/auth/register", { name: "Budi", email, password: PASSWORD });
    await post("/auth/verify", { email, code: code(email) });
    const g = await google(randomUUID(), email.toUpperCase().replace("@TEST.DEV", "@Test.Dev"));
    expect(g.json.created).toBe(false);
  });

  it("takes over an account that never confirmed its address: Google proves ownership, the registered password is dropped", async () => {
    const email = fresh();
    expect((await post("/auth/register", { name: "Penyerang", email, password: PASSWORD })).status).toBe(202);

    const g = await google(randomUUID(), email);
    expect(g.status).toBe(200);
    expect(g.json.created).toBe(false);
    // The password someone typed before the owner showed up must not work.
    expect((await post("/auth/login", { email, password: PASSWORD })).status).toBe(401);
    // Nor can the old emailed code.
    expect((await post("/auth/verify", { email, code: code(email) })).status).toBe(409);
  });

  it("refuses to merge a second Google account into an address that is linked to another one", async () => {
    const email = fresh();
    await google(randomUUID(), email);
    const other = await google(randomUUID(), email);
    expect(other.status).toBe(409);
    expect(other.json.code).toBe("google_conflict");
  });

  it("does not let a Google-only account sign in with a password, but 'forgot password' can add one", async () => {
    const email = fresh();
    await google(randomUUID(), email);
    for (const password of ["!google", "x", PASSWORD]) {
      expect((await post("/auth/login", { email, password })).status).toBe(401);
    }
    await post("/auth/forgot", { email });
    const link = sent.filter((m) => m.to === email).at(-1)!.text.match(/token=([\w-]+)/)![1]!;
    expect((await post("/auth/reset", { token: link, password: PASSWORD })).status).toBe(200);
    expect((await post("/auth/login", { email, password: PASSWORD })).status).toBe(200);
  });

  it("refuses a disabled account", async () => {
    const email = fresh();
    const sub = randomUUID();
    await google(sub, email);
    await db.update(users).set({ disabledAt: new Date() }).where(eq(users.email, email));
    const r = await google(sub, email);
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("account_disabled");
  });

  it("refuses a token that fails verification and a request without one", async () => {
    expect((await post("/auth/google", { idToken: "x".repeat(40) })).status).toBe(401);
    expect((await post("/auth/google", {})).status).toBe(400);
  });

  it("answers 404 when Google sign-in is not configured", async () => {
    const r = await post("/auth/google", { idToken: `tok:${randomUUID()}:${fresh()}` }, appWithoutGoogle);
    expect(r.status).toBe(404);
    expect(r.json.code).toBe("google_disabled");
  });
});
