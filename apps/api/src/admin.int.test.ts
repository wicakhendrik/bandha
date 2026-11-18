import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { adminAudit, users } from "@bandha/db";
import { call, db, pool } from "./test-utils";

/** The dev database is shared, so the admins made here are turned back into normal users when the tests end. */
const madeAdmins: string[] = [];
afterAll(async () => {
  if (madeAdmins.length) await db.update(users).set({ role: "user" }).where(inArray(users.id, madeAdmins));
  await pool.end();
});

const PASSWORD = "password-panjang-1";
/** Each request comes from its own address, so the per-IP limiters never interfere with unrelated tests. */
const from = () => ({ "x-forwarded-for": `10.2.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });

async function person(name = "Uji Admin") {
  const email = `admin-${randomUUID()}@test.dev`;
  const r = await call("POST", "/auth/register", null, { name, email, password: PASSWORD });
  expect(r.status).toBe(201);
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  return { id: row!.id, email, token: r.json.tokens.accessToken as string, refresh: r.json.tokens.refreshToken as string };
}
/** Admin rights are only ever granted from the command line, so the tests write the role directly. */
async function admin() {
  const a = await person("Admin Uji");
  await db.update(users).set({ role: "admin" }).where(eq(users.id, a.id));
  madeAdmins.push(a.id);
  return a;
}
const login = (email: string, password = PASSWORD) => call("POST", "/auth/login", null, { email, password }, from());
const list = (token: string, q: string, status = "all") => call("GET", `/admin/users?q=${encodeURIComponent(q)}&status=${status}`, token);

describe("admin: access", () => {
  it("needs a session and the admin role; /me tells which role you have", async () => {
    const u = await person();
    const a = await admin();
    expect((await call("GET", "/admin/users", null)).status).toBe(401);
    for (const path of ["/admin/users", "/admin/stats", "/admin/audit"]) {
      const r = await call("GET", path, u.token);
      expect(r.status).toBe(403);
    }
    expect((await call("POST", `/admin/users/${u.id}/disable`, u.token, {})).status).toBe(403);
    expect((await call("GET", "/me", u.token)).json.role).toBe("user");
    expect((await call("GET", "/me", a.token)).json.role).toBe("admin");
    expect((await call("GET", "/admin/users", a.token)).status).toBe(200);
  });

  it("removing the admin role takes effect immediately, with the same token", async () => {
    const a = await admin();
    expect((await call("GET", "/admin/stats", a.token)).status).toBe(200);
    await db.update(users).set({ role: "user" }).where(eq(users.id, a.id));
    expect((await call("GET", "/admin/stats", a.token)).status).toBe(403);
  });
});

describe("admin: user list", () => {
  it("finds people by email or name, shows status and counts only, and treats % and _ literally", async () => {
    const a = await admin();
    const u = await person("Siti Aminah");
    await call("POST", "/accounts", u.token, { name: "Dompet", kind: "cash" });

    const found = await list(a.token, u.email);
    expect(found.status).toBe(200);
    expect(found.json.total).toBe(1);
    const row = found.json.users[0];
    expect(row).toMatchObject({ id: u.id, email: u.email, name: "Siti Aminah", role: "user", verified: true, disabledAt: null, accounts: 1, transactions: 0 });
    expect(row.lastActiveAt).toEqual(expect.any(String));
    // No financial data and no secrets in the payload.
    expect(Object.keys(row).sort()).toEqual(["accounts", "createdAt", "disabledAt", "email", "id", "lastActiveAt", "name", "role", "transactions", "verified"]);

    expect((await list(a.token, "siti aminah")).json.users.some((x: { id: string }) => x.id === u.id)).toBe(true);
    expect((await list(a.token, "%")).json.total).toBe(0);
    expect((await list(a.token, "_")).json.total).toBe(0);
  });

  it("filters by status and paginates", async () => {
    const a = await admin();
    const u = await person();
    await call("POST", `/admin/users/${u.id}/disable`, a.token, {});
    expect((await list(a.token, u.email, "disabled")).json.total).toBe(1);
    expect((await list(a.token, u.email, "active")).json.total).toBe(0);
    await call("POST", `/admin/users/${u.id}/enable`, a.token);
    expect((await list(a.token, u.email, "active")).json.total).toBe(1);

    await db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, u.id));
    expect((await list(a.token, u.email, "unverified")).json.total).toBe(1);

    const page = await call("GET", "/admin/users?limit=2&offset=0", a.token);
    expect(page.json.users.length).toBe(2);
    expect(page.json.total).toBeGreaterThanOrEqual(3);
  });
});

describe("admin: disabling an account", () => {
  it("takes effect at once: old token, sign-in and refresh are all refused, and nothing else is touched", async () => {
    const a = await admin();
    const u = await person();
    const other = await person();
    expect((await call("GET", "/accounts", u.token)).status).toBe(200);

    expect((await call("POST", `/admin/users/${u.id}/disable`, a.token, { reason: "spam" })).status).toBe(204);

    const old = await call("GET", "/accounts", u.token); // the access token is still unexpired
    expect(old.status).toBe(401);
    expect(old.json.code).toBe("account_disabled");
    expect((await call("POST", "/auth/refresh", null, { refreshToken: u.refresh }, from())).status).toBe(401);
    const signIn = await login(u.email);
    expect(signIn.status).toBe(403);
    expect(signIn.json).toMatchObject({ code: "account_disabled" });
    // A wrong password still looks like any other wrong password.
    expect((await login(u.email, "salah-salah-123")).status).toBe(401);
    // Someone else is unaffected.
    expect((await call("GET", "/accounts", other.token)).status).toBe(200);
    expect((await login(other.email)).status).toBe(200);
  });

  it("can be undone: the person signs in again with the same password", async () => {
    const a = await admin();
    const u = await person();
    await call("POST", `/admin/users/${u.id}/disable`, a.token, {});
    expect((await call("POST", `/admin/users/${u.id}/enable`, a.token)).status).toBe(204);
    expect((await login(u.email)).status).toBe(200);
  });

  it("refuses to disable yourself, another admin, or somebody who does not exist", async () => {
    const a = await admin();
    const b = await admin();
    expect((await call("POST", `/admin/users/${a.id}/disable`, a.token, {})).status).toBe(400);
    expect((await call("POST", `/admin/users/${b.id}/disable`, a.token, {})).status).toBe(409);
    expect((await call("POST", `/admin/users/${randomUUID()}/disable`, a.token, {})).status).toBe(404);
    expect((await call("POST", "/admin/users/bukan-uuid/disable", a.token, {})).status).toBe(404);
    // Neither admin was locked out.
    expect((await call("GET", "/admin/stats", a.token)).status).toBe(200);
    expect((await call("GET", "/admin/stats", b.token)).status).toBe(200);
  });

  it("signing someone out keeps the account usable", async () => {
    const a = await admin();
    const u = await person();
    const second = await login(u.email); // a second device
    const r = await call("POST", `/admin/users/${u.id}/revoke-sessions`, a.token);
    expect(r.status).toBe(200);
    expect(r.json.revoked).toBeGreaterThanOrEqual(2);
    expect((await call("POST", "/auth/refresh", null, { refreshToken: u.refresh }, from())).status).toBe(401);
    expect((await call("POST", "/auth/refresh", null, { refreshToken: second.json.tokens.refreshToken }, from())).status).toBe(401);
    expect((await login(u.email)).status).toBe(200);
    expect((await call("POST", `/admin/users/${a.id}/revoke-sessions`, a.token)).status).toBe(400);
  });
});

describe("admin: audit log", () => {
  it("records who did what to whom, once per real change, newest first", async () => {
    const a = await admin();
    const u = await person();
    await call("POST", `/admin/users/${u.id}/disable`, a.token, { reason: "uji coba" });
    await call("POST", `/admin/users/${u.id}/disable`, a.token, {}); // already disabled: no second entry
    await call("POST", `/admin/users/${u.id}/enable`, a.token);
    await call("POST", `/admin/users/${u.id}/revoke-sessions`, a.token);

    const mine = (await db.select().from(adminAudit).where(eq(adminAudit.targetUserId, u.id))).map((r) => r.action).sort();
    expect(mine).toEqual(["user.disable", "user.enable", "user.revoke_sessions"]);

    const r = await call("GET", "/admin/audit?limit=50", a.token);
    expect(r.status).toBe(200);
    const entries = (r.json.entries as Array<{ actor: string; action: string; target: string; detail: string | null; at: string }>).filter((e) => e.target === u.email);
    expect(entries.map((e) => e.action)).toEqual(["user.revoke_sessions", "user.enable", "user.disable"]);
    expect(entries.every((e) => e.actor === a.email)).toBe(true);
    expect(entries[2]!.detail).toBe("uji coba");
    expect(r.json.total).toBeGreaterThanOrEqual(3);
    expect((await call("GET", "/admin/audit?limit=1&offset=0", a.token)).json.entries.length).toBe(1);
  });
});

describe("admin: statistics", () => {
  it("counts people, activity and sign-ups, with every one of the last 30 days present", async () => {
    const a = await admin();
    await person();
    const r = await call("GET", "/admin/stats", a.token);
    expect(r.status).toBe(200);
    const s = r.json;
    expect(s.users.total).toBeGreaterThanOrEqual(2);
    expect(s.users.admins).toBeGreaterThanOrEqual(1);
    expect(s.users.verified + s.users.unverified).toBe(s.users.total);
    expect(s.active.last24h).toBeGreaterThanOrEqual(2);
    expect(s.active.last24h).toBeLessThanOrEqual(s.active.last7d);
    expect(s.active.last7d).toBeLessThanOrEqual(s.active.last30d);
    expect(s.newUsers.last7d).toBeLessThanOrEqual(s.newUsers.last30d);
    expect(s.signups).toHaveLength(30);
    expect(s.signups.at(-1).count).toBeGreaterThanOrEqual(2);
    expect(s.signups.reduce((n: number, d: { count: number }) => n + d.count, 0)).toBe(s.newUsers.last30d);
    expect(s.data).toEqual({ accounts: expect.any(Number), transactions: expect.any(Number) });
    expect(s.market).toEqual({ quotes: expect.any(Number), lastQuoteAt: expect.anything() });
  });
});
