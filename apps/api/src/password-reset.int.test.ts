import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { passwordResets, users } from "@bandha/db";
import { call, db, pool, sentMail } from "./test-utils";

afterAll(async () => { await pool.end(); });

const PASSWORD = "password-panjang-1";
const NEW_PASSWORD = "kata-sandi-baru-2026";
/** Each request comes from its own address, so the per-IP limiter never interferes with unrelated tests. */
const from = () => ({ "x-forwarded-for": `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });

async function account() {
  const email = `reset-${randomUUID()}@test.dev`;
  const r = await call("POST", "/auth/register", null, { name: "Uji", email, password: PASSWORD });
  expect(r.status).toBe(201);
  return { email, tokens: r.json.tokens as { accessToken: string; refreshToken: string } };
}
const forgot = (email: string) => call("POST", "/auth/forgot", null, { email }, from());
const mailTo = (email: string) => sentMail.filter((m) => m.to === email);
const tokenOf = (email: string, nth = -1) => {
  const m = mailTo(email).at(nth);
  expect(m, "mail sent").toBeTruthy();
  const url = new URL(m!.text.match(/https?:\/\/\S+/)![0]);
  expect(url.pathname).toBe("/reset-password");
  return url.searchParams.get("token")!;
};
const reset = (token: string, password = NEW_PASSWORD) => call("POST", "/auth/reset", null, { token, password }, from());
const login = (email: string, password: string) => call("POST", "/auth/login", null, { email, password }, from());

describe("password reset", () => {
  it("sends a link, sets the new password, and signs the account out everywhere", async () => {
    const { email, tokens } = await account();
    const r = await forgot(email);
    expect(r).toMatchObject({ status: 200, json: { ok: true } });
    expect(mailTo(email)).toHaveLength(1);
    expect(mailTo(email)[0]!.subject).toContain("kata sandi");
    expect(mailTo(email)[0]!.html).toContain("reset-password?token=");
    const token = tokenOf(email);

    expect((await reset(token)).status).toBe(200);
    expect((await login(email, PASSWORD)).status).toBe(401);
    expect((await login(email, NEW_PASSWORD)).status).toBe(200);
    // the session that existed before the reset can no longer be refreshed
    expect((await call("POST", "/auth/refresh", null, { refreshToken: tokens.refreshToken }, from())).status).toBe(401);
  });

  it("a link works once only", async () => {
    const { email } = await account();
    await forgot(email);
    const token = tokenOf(email);
    expect((await reset(token)).status).toBe(200);
    const again = await reset(token, "nother-password-2026");
    expect(again.status).toBe(400);
    expect(again.json.error).toContain("tidak valid");
    expect((await login(email, NEW_PASSWORD)).status).toBe(200); // the second attempt changed nothing
  });

  it("answers the same for an unknown email, and sends nothing", async () => {
    const { email } = await account();
    const known = await forgot(email);
    const unknown = await forgot(`nobody-${randomUUID()}@test.dev`);
    expect(unknown.status).toBe(known.status);
    expect(unknown.json).toEqual(known.json);
    expect(sentMail.some((m) => m.to.startsWith("nobody-"))).toBe(false);
  });

  it("a newer request replaces the older link", async () => {
    const { email } = await account();
    await forgot(email);
    await forgot(email);
    expect(mailTo(email)).toHaveLength(2);
    const [first, second] = [tokenOf(email, 0), tokenOf(email, 1)];
    expect(first).not.toBe(second);
    expect((await reset(first)).status).toBe(400);
    expect((await reset(second)).status).toBe(200);
  });

  it("rejects expired, unknown and malformed tokens; a weak password does not burn the link", async () => {
    const { email } = await account();
    await forgot(email);
    const token = tokenOf(email);

    const weak = await reset(token, "pendek");
    expect(weak.status).toBe(400);
    expect(weak.json.issues[0].path).toBe("password");
    expect((await reset("x".repeat(43))).status).toBe(400);
    expect((await reset("short")).status).toBe(400);

    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    await db.update(passwordResets).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(passwordResets.userId, u!.id));
    expect((await reset(token)).status).toBe(400);
    expect((await login(email, PASSWORD)).status).toBe(200); // password untouched

    await forgot(email);
    expect((await reset(tokenOf(email))).status).toBe(200);
  });

  it("stores only a hash of the token", async () => {
    const { email } = await account();
    await forgot(email);
    const token = tokenOf(email);
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    const rows = await db.select().from(passwordResets).where(eq(passwordResets.userId, u!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toContain(token);
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("caps reset emails per account per hour, and rate limits each address", async () => {
    const { email } = await account();
    for (let i = 0; i < 5; i++) await forgot(email);
    expect(mailTo(email)).toHaveLength(3);

    const ip = { "x-forwarded-for": "203.0.113.9" };
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await call("POST", "/auth/forgot", null, { email: `x-${i}@test.dev` }, ip)).status);
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it("validates the email field and treats the address case-insensitively", async () => {
    const { email } = await account();
    expect((await call("POST", "/auth/forgot", null, { email: "not-an-email" }, from())).status).toBe(400);
    expect((await call("POST", "/auth/forgot", null, {}, from())).status).toBe(400);
    await forgot(email.toUpperCase());
    expect(mailTo(email)).toHaveLength(1);
  });
});
