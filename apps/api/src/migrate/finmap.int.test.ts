import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accounts, assets, seedAssets, transactions, users } from "@bandha/db";
import { call, db, pool } from "../test-utils";
import { FINMAP_MIN_DDL, seedFinmap, type FixtureOptions } from "./finmap-fixture";
import { migrateOne } from "./finmap-run";

const url = process.env.DATABASE_URL ?? "postgres://bandha:bandha@localhost:5434/bandha";
const schema = `fm_test_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
let admin: pg.Pool;
let source: pg.Pool;

beforeAll(async () => {
  await seedAssets(db);
  admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query(`create schema ${schema}`);
  // The FinMap database is a separate schema here. The loader runs against it through search_path, exactly as it would run against a real FinMap database.
  source = new pg.Pool({ connectionString: url, max: 3, options: `-c search_path=${schema}` });
  const c = await source.connect();
  for (const ddl of FINMAP_MIN_DDL) await c.query(ddl);
  c.release();
});
afterAll(async () => {
  await source.end();
  await admin.query(`drop schema ${schema} cascade`);
  await admin.end();
  await pool.end();
});

/** Each test gets its own FinMap person, so tests do not interfere. */
async function person(opts: FixtureOptions = {}) {
  const email = `fm-${randomUUID()}@contoh.id`;
  const c = await source.connect();
  try { return await seedFinmap(c, { ...opts, email }); } finally { c.release(); }
}
const exists = async (email: string) => (await db.select({ id: users.id }).from(users).where(eq(users.email, email))).length > 0;
const balances = async (token: string) => {
  const list = (await call("GET", "/accounts?archived=true", token)).json.accounts as Array<{ name: string; balances: Array<{ symbol: string; quantity: string }> }>;
  return Object.fromEntries(list.map((a) => [a.name, Object.fromEntries(a.balances.map((b) => [b.symbol, Number(b.quantity)]))]));
};

describe("FinMap -> Bandha migration", () => {
  it("a dry run does everything, reports it, and writes nothing", async () => {
    const f = await person();
    const r = await migrateOne(source, db, { email: f.email, apply: false });
    expect(r.committed).toBe(false);
    expect(r.notCommittedBecause).toContain("Dry-run");
    expect(r.result!.failures).toEqual([]);
    expect(r.result!.mismatches).toEqual([]);
    expect(r.result!.counts.steps).toMatchObject({ opening: 5, income: 2, expense: 3, transfer: 1, buy: 1, sell: 1 });
    expect(r.result!.counts.debts).toBe(2);
    expect(await exists(f.email)).toBe(false);
  });

  it("applies: balances equal FinMap's, the person logs in with the FinMap password, debts and archive carry over", async () => {
    const f = await person();
    const r = await migrateOne(source, db, { email: f.email, apply: true });
    expect(r.notCommittedBecause).toBeUndefined();
    expect(r.committed).toBe(true);
    expect(r.result!.failures).toEqual([]);
    expect(r.result!.mismatches).toEqual([]);

    // the argon2 hash from FinMap works, and is replaced by a native one on that first login
    const [before] = await db.select().from(users).where(eq(users.email, f.email));
    expect(before!.passwordHash.startsWith("$argon2")).toBe(true);
    const login = await call("POST", "/auth/login", null, { email: f.email, password: f.password });
    expect(login.status).toBe(200);
    expect((await call("POST", "/auth/login", null, { email: f.email, password: "salah-salah-1" })).status).toBe(401);
    const [after] = await db.select().from(users).where(eq(users.email, f.email));
    expect(after!.passwordHash.startsWith("scrypt$")).toBe(true);
    expect((await call("POST", "/auth/login", null, { email: f.email, password: f.password })).status).toBe(200);

    const token = login.json.tokens.accessToken as string;
    const b = await balances(token);
    expect(b["BCA Tabungan"]).toEqual({ IDR: 10_000_000 + 8_000_000 - 502_500 - 5_007_500 + 55_000_000 + 1_250_000 });
    expect(b["GoPay"]).toEqual({ IDR: 200_000 - 150_000 + 500_000 });
    expect(b["Indodax"]).toMatchObject({ PEPE: 1_000_000, USD: 100 });
    expect(b["Indodax"]!["BTC"]).toBeCloseTo(0.41, 10);
    expect(Object.keys(b)).toContain("Bank Lama Tabungan Lama");
    // the account of the archived source is archived, the others are not
    const rows = await db.select({ name: accounts.name, archivedAt: accounts.archivedAt }).from(accounts).where(eq(accounts.workspaceId, r.result!.workspaceId));
    expect(rows.filter((a) => a.archivedAt).map((a) => a.name)).toEqual(["Bank Lama Tabungan Lama"]);

    // BTC cost basis: 0.5 @ 500M + 0.01 @ 5M, then 0.1 sold at the weighted average
    const pf = (await call("GET", "/portfolio", token)).json;
    const btc = pf.positions.find((p: { symbol: string }) => p.symbol === "BTC");
    expect(Number(btc.quantity)).toBeCloseTo(0.41, 8);
    expect(Number(btc.costBasis)).toBeCloseTo((250_000_000 + 5_000_000) * (0.41 / 0.51), 0);

    // debts came across as existing contracts, sized by what was left
    const debts = (await call("GET", "/debts", token)).json;
    expect(debts.totals).toEqual({ payable: "80000000", receivable: "500000" });
    expect(debts.debts.find((d: { counterparty: string }) => d.counterparty === "KPR BCA")).toMatchObject({ kind: "mortgage", dueDate: "2026-12-05", direction: "payable" });

    // migrated transactions are tagged, dated as in FinMap, and the whole ledger balances
    const list = (await call("GET", "/transactions?limit=100", token)).json.transactions as Array<{ tags: string[]; occurredAt: string; description: string | null }>;
    expect(list.filter((t) => t.tags.includes("dari-finmap")).length).toBeGreaterThan(10);
    expect(list.find((t) => t.description === "Makan siang")!.occurredAt).toContain("2026-02-03");
    const ledger = await call("GET", "/dashboard", token);
    expect(ledger.status).toBe(200);
  });

  it("never merges into or overwrites an existing Bandha account", async () => {
    const f = await person();
    await migrateOne(source, db, { email: f.email, apply: true });
    await expect(migrateOne(source, db, { email: f.email, apply: true })).rejects.toThrow(/sudah terdaftar/);
    expect(await db.select({ id: users.id }).from(users).where(eq(users.email, f.email))).toHaveLength(1);
  });

  it("a transaction Bandha refuses is reported, and stops the commit unless told otherwise", async () => {
    const f = await person({ badTransfer: true });
    const dry = await migrateOne(source, db, { email: f.email, apply: false });
    expect(dry.result!.failures).toHaveLength(1);
    expect(dry.result!.failures[0]!.what).toContain("transfer");
    expect(dry.result!.failures[0]!.error).toContain("melebihi");
    expect(dry.result!.mismatches.length).toBeGreaterThan(0);

    const refused = await migrateOne(source, db, { email: f.email, apply: true });
    expect(refused.committed).toBe(false);
    expect(refused.notCommittedBecause).toContain("gagal");
    expect(await exists(f.email)).toBe(false);

    const onlyFailed = await migrateOne(source, db, { email: f.email, apply: true, skipFailed: true });
    expect(onlyFailed.committed).toBe(false);
    expect(onlyFailed.notCommittedBecause).toContain("saldo");
    expect(await exists(f.email)).toBe(false);

    const forced = await migrateOne(source, db, { email: f.email, apply: true, skipFailed: true, allowMismatch: true });
    expect(forced.committed).toBe(true);
    expect(await exists(f.email)).toBe(true);
  });

  it("adds assets Bandha does not know, priced when FinMap knew a CoinGecko id", async () => {
    const symbol = `ZZ${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    const dry = await migrateOne(source, db, { email: (await person({ exotic: symbol })).email, apply: false });
    expect(dry.result!.assetsCreated.join(" ")).toContain(`${symbol} (crypto, harga dari CoinGecko)`);
    // the dry run rolled the new asset back as well
    expect(await db.select().from(assets).where(eq(assets.symbol, symbol))).toHaveLength(0);

    // a coin FinMap had no CoinGecko id for is added too, just without a price source (kept out of the price sync)
    const plain = `ZY${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    const f = await person({ exotic: plain, exoticUnpriced: true });
    const r = await migrateOne(source, db, { email: f.email, apply: true });
    expect(r.committed).toBe(true);
    expect(r.result!.mismatches).toEqual([]);
    expect(r.result!.assetsCreated.join(" ")).toContain(`${plain} (crypto, tanpa sumber harga)`);
    const [coin] = await db.select().from(assets).where(eq(assets.symbol, plain));
    expect(coin).toMatchObject({ kind: "crypto", providerRef: null });
  });

  it("gold waits for a unit; ounces are stored as grams and still reconcile", async () => {
    const f = await person({ gold: true });
    const stopped = await migrateOne(source, db, { email: f.email, apply: true });
    expect(stopped.committed).toBe(false);
    expect(stopped.result).toBeUndefined();
    expect(stopped.plan.blockers[0]).toContain("--gold-unit");

    const r = await migrateOne(source, db, { email: f.email, apply: true, goldUnit: "ounce" });
    expect(r.committed).toBe(true);
    expect(r.result!.mismatches).toEqual([]);
    const login = await call("POST", "/auth/login", null, { email: f.email, password: f.password });
    const b = await balances(login.json.tokens.accessToken);
    expect(b["BCA Tabungan"]!["XAU"]).toBeCloseTo(2 * 31.1034768, 6);
  });

  it("a FinMap account without a password migrates, and can set one with the reset flow", async () => {
    const f = await person({ passwordless: true, otherMember: true });
    const r = await migrateOne(source, db, { email: f.email, apply: true });
    expect(r.committed).toBe(true);
    expect(r.plan.warnings.join(" ")).toContain("Lupa kata sandi");
    expect(r.plan.warnings.join(" ")).toContain("2 orang");
    expect((await call("POST", "/auth/login", null, { email: f.email, password: f.password })).status).toBe(401);
    const [u] = await db.select().from(users).where(eq(users.email, f.email));
    expect(u!.passwordHash).not.toMatch(/^\$argon2|^scrypt/);
  });

  it("an unknown person is an error, not an empty migration", async () => {
    await expect(migrateOne(source, db, { email: "tidak-ada@contoh.id", apply: false })).rejects.toThrow(/tidak ditemukan/);
  });

  it("the FinMap side is only ever read", async () => {
    const f = await person();
    const count = async () => Number((await source.query(`select (select count(*) from "Transaction") + (select count(*) from "Account") + (select count(*) from "User") as n`)).rows[0].n);
    const before = await count();
    await migrateOne(source, db, { email: f.email, apply: true });
    expect(await count()).toBe(before);
    // and the loader's session is read only: a write attempted through it is refused by the database
    const c = await source.connect();
    try {
      await c.query("begin transaction read only");
      await expect(c.query(`update "Account" set name = name`)).rejects.toThrow(/read-only/);
      await c.query("rollback");
    } finally { c.release(); }
    expect(await db.select({ n: transactions.id }).from(transactions).limit(1)).toBeDefined();
  });
});
