import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { emailVerifications, users } from "@bandha/db";
import { createApp } from "./app";
import { loadConfig } from "./config";
import type { MailMessage } from "./mailer";
import { db, pool, services } from "./test-utils";

afterAll(async () => { await pool.end(); });

// A second app with email verification ON (the shared test app keeps the one-step registration).
const sent: MailMessage[] = [];
let failMail = false;
const app = createApp({
  db,
  config: loadConfig({ DATABASE_URL: "x", JWT_SECRET: "t".repeat(40), MARKET_PROVIDER: "fake", REQUIRE_EMAIL_OTP: "true" }),
  services,
  mailer: { send: async (m) => { if (failMail) throw new Error("smtp down"); sent.push(m); } },
});

/** Every request has its own address, so the per-IP limiters never interfere with other tests. */
const ip = () => ({ "x-forwarded-for": `10.2.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
async function post(path: string, body: unknown, headers = ip()) {
  const res = await app.request(`/api${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}
const get = async (path: string, token: string) => {
  const res = await app.request(`/api${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, json: await res.json() };
};

const PASSWORD = "password-panjang-1";
const fresh = () => `otp-${randomUUID()}@test.dev`;
const codeFor = (email: string) => {
  const m = sent.filter((x) => x.to === email).at(-1);
  expect(m, `a code was emailed to ${email}`).toBeTruthy();
  return m!.text.match(/Kode verifikasi Bandha Anda: (\d{6})/)![1]!;
};
const register = (email: string, name = "Uji OTP") => post("/auth/register", { name, email, password: PASSWORD });
/** Skips the one-minute resend wait without waiting: rewinds the last code's creation time. */
async function ageCode(email: string) {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  await db.update(emailVerifications).set({ createdAt: new Date(Date.now() - 120_000) }).where(eq(emailVerifications.userId, u!.id));
}

describe("registration with an emailed code", () => {
  it("creates an unverified account, emails a 6-digit code, and signs in only after the right code", async () => {
    const email = fresh();
    const r = await register(email);
    expect(r.status).toBe(202);
    expect(r.json).toEqual({ verificationRequired: true, email, resendInSeconds: 60 });
    expect(r.json.tokens).toBeUndefined();

    const mail = sent.filter((m) => m.to === email);
    expect(mail).toHaveLength(1);
    expect(mail[0]!.subject).toContain("Kode verifikasi");
    expect(mail[0]!.html).toContain("Your Bandha verification code");
    const code = codeFor(email);
    expect(code).toMatch(/^\d{6}$/);

    // not signed in yet: the password alone is not enough
    const early = await post("/auth/login", { email, password: PASSWORD });
    expect(early.status).toBe(403);
    expect(early.json).toMatchObject({ code: "email_unverified", email });

    const ok = await post("/auth/verify", { email, code });
    expect(ok.status).toBe(200);
    expect(ok.json.user).toMatchObject({ email, name: "Uji OTP" });
    expect((await get("/me", ok.json.tokens.accessToken)).json.user.email).toBe(email);
    // now an ordinary login works, and the same code cannot be used again
    expect((await post("/auth/login", { email, password: PASSWORD })).status).toBe(200);
    expect((await post("/auth/verify", { email, code })).status).toBe(409);
  });

  it("never stores the code itself, only a hash", async () => {
    const email = fresh();
    await register(email);
    const code = codeFor(email);
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    const [row] = await db.select().from(emailVerifications).where(eq(emailVerifications.userId, u!.id));
    expect(row!.codeHash).not.toContain(code);
    expect(row!.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.expiresAt.getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
  });

  it("counts wrong guesses and burns the code after five", async () => {
    const email = fresh();
    await register(email);
    const code = codeFor(email);
    const wrong = code === "000000" ? "111111" : "000000";
    const first = await post("/auth/verify", { email, code: wrong });
    expect(first.status).toBe(400);
    expect(first.json.error).toContain("Sisa percobaan: 4");
    for (let i = 0; i < 3; i++) await post("/auth/verify", { email, code: wrong });
    const last = await post("/auth/verify", { email, code: wrong });
    expect(last.status).toBe(400);
    expect(last.json.error).toContain("Minta kode baru");
    // even the correct code is dead now
    expect((await post("/auth/verify", { email, code })).status).toBe(400);
    // a new code works
    await ageCode(email);
    expect((await post("/auth/verify/resend", { email })).status).toBe(200);
    expect((await post("/auth/verify", { email, code: codeFor(email) })).status).toBe(200);
  });

  it("rejects an expired code", async () => {
    const email = fresh();
    await register(email);
    const code = codeFor(email);
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    await db.update(emailVerifications).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(emailVerifications.userId, u!.id));
    const r = await post("/auth/verify", { email, code });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("kedaluwarsa");
  });

  it("resend: one email a minute, a new code replaces the old one, and the answer never reveals whether the address exists", async () => {
    const email = fresh();
    await register(email);
    const first = codeFor(email);
    const quick = await post("/auth/verify/resend", { email });
    expect(quick.status).toBe(200);
    expect(sent.filter((m) => m.to === email)).toHaveLength(1); // still inside the minute: nothing new went out

    await ageCode(email);
    expect((await post("/auth/verify/resend", { email })).json).toMatchObject({ ok: true });
    expect(sent.filter((m) => m.to === email)).toHaveLength(2);
    const second = codeFor(email);
    if (second !== first) expect((await post("/auth/verify", { email, code: first })).status).toBe(400); // the old code is replaced
    expect((await post("/auth/verify", { email, code: second })).status).toBe(200);

    const before = sent.length;
    const ghost = await post("/auth/verify/resend", { email: fresh() });
    expect(ghost.json).toMatchObject({ ok: true }); // same answer for an address that does not exist
    expect(sent.length).toBe(before);
  });

  it("caps emails at five an hour for one address", async () => {
    const email = fresh();
    await register(email);
    for (let i = 0; i < 6; i++) { await ageCode(email); await post("/auth/verify/resend", { email }); }
    expect(sent.filter((m) => m.to === email)).toHaveLength(5);
  });

  it("registering again with an unconfirmed address replaces the pending details; a confirmed address is taken", async () => {
    const email = fresh();
    await register(email, "Pemilik Palsu");
    await ageCode(email);
    const again = await post("/auth/register", { name: "Pemilik Asli", email, password: "kata-sandi-lain-2026" });
    expect(again.status).toBe(202);
    const ok = await post("/auth/verify", { email, code: codeFor(email) });
    expect(ok.json.user.name).toBe("Pemilik Asli");
    expect((await post("/auth/login", { email, password: PASSWORD })).status).toBe(401); // the first password is gone
    expect((await post("/auth/login", { email, password: "kata-sandi-lain-2026" })).status).toBe(200);

    const taken = await register(email);
    expect(taken.status).toBe(409);
  });

  it("reports a mail failure instead of silently leaving the person waiting", async () => {
    const email = fresh();
    failMail = true;
    const r = await register(email);
    failMail = false;
    expect(r.status).toBe(503);
    expect(r.json.error).toContain("gagal dikirim");
    // they can simply try again
    expect((await register(email)).status).toBe(202);
  });

  it("checks the input: six digits, valid email", async () => {
    expect((await post("/auth/verify", { email: fresh(), code: "12345" })).status).toBe(400);
    expect((await post("/auth/verify", { email: "bukan-email", code: "123456" })).status).toBe(400);
    expect((await post("/auth/verify", { email: fresh(), code: "123456" })).status).toBe(400); // unknown address: same generic error
  });

  it("is rate limited per address", async () => {
    const h = ip();
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await post("/auth/verify", { email: fresh(), code: "123456" }, h)).status;
    expect(last).toBe(429);
  });

  it("a password reset link also proves the address, so an unverified account can sign in afterwards", async () => {
    const email = fresh();
    await register(email);
    await post("/auth/forgot", { email });
    const link = sent.filter((m) => m.to === email && /reset-password/.test(m.text)).at(-1)!.text.match(/https?:\/\/\S+/)![0];
    const token = new URL(link).searchParams.get("token")!;
    expect((await post("/auth/reset", { token, password: "kata-sandi-baru-2026" })).status).toBe(200);
    expect((await post("/auth/login", { email, password: "kata-sandi-baru-2026" })).status).toBe(200);
  });
});

describe("existing accounts and the switch", () => {
  it("accounts created before verification existed were marked verified by the migration (no unverified old users)", async () => {
    const rows = await db.select({ n: users.id }).from(users).where(eq(users.email, "nobody@invalid.test"));
    expect(rows).toHaveLength(0); // sanity: query works
    const unverified = await db.execute(`select count(*)::int as n from users where email_verified_at is null and created_at < now() - interval '1 day'` as never);
    expect((unverified.rows[0] as { n: number }).n).toBe(0);
  });

  it("with REQUIRE_EMAIL_OTP=false registration signs in at once and marks the account verified", async () => {
    const off = createApp({ db, config: loadConfig({ DATABASE_URL: "x", JWT_SECRET: "t".repeat(40), MARKET_PROVIDER: "fake", REQUIRE_EMAIL_OTP: "false" }), services });
    const email = fresh();
    const res = await off.request("/api/auth/register", { method: "POST", headers: { "content-type": "application/json", ...ip() }, body: JSON.stringify({ name: "Tanpa OTP", email, password: PASSWORD }) });
    expect(res.status).toBe(201);
    expect((await res.json()).tokens.accessToken).toBeTruthy();
    const [u] = await db.select({ v: users.emailVerifiedAt }).from(users).where(eq(users.email, email));
    expect(u!.v).not.toBeNull();
  });
});
