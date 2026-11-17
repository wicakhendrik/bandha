import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { call, pool } from "./test-utils";

afterAll(async () => { await pool.end(); });

const PASSWORD = "password-panjang-1";
const NEW_PASSWORD = "kata-sandi-baru-2026";
/** Each request comes from its own address, so the per-IP limiters never interfere with unrelated tests. */
const from = () => ({ "x-forwarded-for": `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });

async function account(name = "Uji Profil") {
  const email = `profile-${randomUUID()}@test.dev`;
  const r = await call("POST", "/auth/register", null, { name, email, password: PASSWORD });
  expect(r.status).toBe(201);
  return { email, token: r.json.tokens.accessToken as string, refresh: r.json.tokens.refreshToken as string };
}
const login = (email: string, password: string) => call("POST", "/auth/login", null, { email, password }, from());

describe("profile: name", () => {
  it("renames the signed-in person, trimming the name, and /me shows it", async () => {
    const a = await account();
    const r = await call("PATCH", "/me", a.token, { name: "  Hendrik W  " });
    expect(r.status).toBe(200);
    expect(r.json.user).toMatchObject({ name: "Hendrik W", email: a.email });
    expect((await call("GET", "/me", a.token)).json.user.name).toBe("Hendrik W");
  });

  it("rejects an empty or too long name, and needs a session", async () => {
    const a = await account();
    expect((await call("PATCH", "/me", a.token, { name: "   " })).status).toBe(400);
    expect((await call("PATCH", "/me", a.token, { name: "x".repeat(81) })).status).toBe(400);
    expect((await call("PATCH", "/me", null, { name: "Siapa" })).status).toBe(401);
  });
});

describe("profile: password", () => {
  it("changes the password, then the old one stops working and every session is signed out", async () => {
    const a = await account();
    const other = await login(a.email, PASSWORD); // a second device
    const r = await call("POST", "/me/password", a.token, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, from());
    expect(r.status).toBe(204);

    expect((await login(a.email, PASSWORD)).status).toBe(401);
    expect((await login(a.email, NEW_PASSWORD)).status).toBe(200);
    // refresh tokens of both devices were revoked
    expect((await call("POST", "/auth/refresh", null, { refreshToken: a.refresh }, from())).status).toBe(401);
    expect((await call("POST", "/auth/refresh", null, { refreshToken: other.json.tokens.refreshToken }, from())).status).toBe(401);
  });

  it("refuses a wrong current password with 400 (not 401, which the web client reads as an expired session)", async () => {
    const a = await account();
    const r = await call("POST", "/me/password", a.token, { currentPassword: "salah-salah-1", newPassword: NEW_PASSWORD }, from());
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("saat ini salah");
    expect((await login(a.email, PASSWORD)).status).toBe(200); // nothing changed
  });

  it("refuses a short new password and one that equals the old one", async () => {
    const a = await account();
    expect((await call("POST", "/me/password", a.token, { currentPassword: PASSWORD, newPassword: "pendek" }, from())).status).toBe(400);
    const same = await call("POST", "/me/password", a.token, { currentPassword: PASSWORD, newPassword: PASSWORD }, from());
    expect(same.status).toBe(400);
    expect(same.json.error).toContain("berbeda");
    expect((await call("POST", "/me/password", null, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, from())).status).toBe(401);
  });

  it("is rate limited per address, so the current password cannot be guessed with a stolen session", async () => {
    const a = await account();
    const ip = from();
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await call("POST", "/me/password", a.token, { currentPassword: `salah-${i}-salah`, newPassword: NEW_PASSWORD }, ip)).status;
    expect(last).toBe(429);
  });
});

describe("account ledger: which rows can be edited", () => {
  it("marks ordinary transactions editable and debt transactions not", async () => {
    const a = await account();
    const assets = (await call("GET", "/assets?limit=300", a.token)).json.assets as Array<{ id: string; symbol: string }>;
    const idr = assets.find((x) => x.symbol === "IDR")!.id;
    const acc = (await call("POST", "/accounts", a.token, { name: "BCA", kind: "bank", openingBalance: { assetId: idr, quantity: "1000000" } })).json.account.id as string;
    await call("POST", "/transactions", a.token, { type: "expense", accountId: acc, assetId: idr, quantity: "50000", description: "Kopi" });
    await call("POST", "/debts", a.token, { direction: "receivable", counterparty: "Budi", principal: "200000", accountId: acc });

    const rows = (await call("GET", `/accounts/${acc}/ledger?limit=20`, a.token)).json.rows as Array<{ type: string; editable: boolean }>;
    expect(rows.find((r) => r.type === "expense")?.editable).toBe(true);
    expect(rows.find((r) => r.type === "opening")?.editable).toBe(true);
    expect(rows.find((r) => r.type === "lend")?.editable).toBe(false);
  });
});
