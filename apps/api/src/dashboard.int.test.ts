import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assets, marketQuotesLatest, seedAssets } from "@bandha/db";
import { assetIds, call, createUnpricedAsset, db, newUser, pool, services } from "./test-utils";

let ID: Record<string, string> = {};

beforeAll(async () => {
  await seedAssets(db);
  await services.market.sync();
  ID = await assetIds((await newUser()).token);
});
afterAll(async () => { await pool.end(); });

const account = async (token: string, body: object) => (await call("POST", "/accounts", token, body)).json.account.id as string;
const income = (token: string, accountId: string, assetSymbol: string, quantity: string, extra: object = {}) =>
  call("POST", "/transactions", token, { type: "income", accountId, assetId: ID[assetSymbol], quantity, ...extra });

describe("market data", () => {
  it("stores USD and IDR quotes as separate rows that never overwrite each other", async () => {
    const [usdt] = await db.select().from(assets).where(eq(assets.symbol, "USDT"));
    const rows = await db.select().from(marketQuotesLatest).where(eq(marketQuotesLatest.assetId, usdt!.id));
    expect(rows.length).toBe(2);
    const byQuote = new Map(rows.map((r) => [r.quoteAssetId, r.price]));
    expect(byQuote.get(ID["IDR"]!)).toMatch(/^16200/);
    expect(byQuote.get(ID["USD"]!)).toMatch(/^1(\.0+)?$/);

    // a second sync keeps exactly one latest row per (asset, quote)
    await services.market.sync();
    expect((await db.select().from(marketQuotesLatest).where(eq(marketQuotesLatest.assetId, usdt!.id))).length).toBe(2);
  });

  it("skips a user-triggered refresh when prices are fresh", async () => {
    const u = await newUser();
    const r = await call("POST", "/market-data/refresh", u.token);
    expect(r.status).toBe(200);
    expect(r.json.skipped).toBe(true);
  });
});

describe("dashboard", () => {
  it("requires authentication", async () => {
    expect((await call("GET", "/dashboard", null)).status).toBe(401);
  });

  it("values IDR 1:1 and crypto at the IDR quote, never the USD one", async () => {
    const u = await newUser();
    const bank = await account(u.token, { name: "BCA", kind: "bank", openingBalance: { assetId: ID["IDR"], quantity: "1000000" } });
    const wallet = await account(u.token, { name: "Exchange", kind: "exchange" });
    await income(u.token, wallet, "BTC", "0.5", { functionalAmount: "700000000" });
    await income(u.token, wallet, "USDT", "100", { functionalAmount: "1600000" });

    const d = (await call("GET", "/dashboard", u.token)).json;
    // 1,000,000 + 0.5 * 1,500,000,000 + 100 * 16,200  (USDT is 1,620,000 IDR, not 100)
    expect(d.netWorth).toBe("752620000");
    expect(d.complete).toBe(true);
    expect(d.unpriced).toEqual([]);
    const usdt = d.holdings.find((h: any) => h.symbol === "USDT"); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(usdt.price).toBe("16200");
    expect(usdt.value).toBe("1620000");
    expect(d.holdings[0].symbol).toBe("BTC"); // sorted by value
    expect(d.allocation.map((a: any) => a.key)).toEqual(["crypto", "fiat"]); // eslint-disable-line @typescript-eslint/no-explicit-any
    void bank;
  });

  it("keeps unpriced assets visible instead of valuing them at zero", async () => {
    const u = await newUser();
    await account(u.token, { name: "Kas", kind: "cash", openingBalance: { assetId: ID["IDR"], quantity: "500000" } });
    const gold = await account(u.token, { name: "Emas", kind: "gold" });
    const np = await createUnpricedAsset();
    await call("POST", "/transactions", u.token, { type: "income", accountId: gold, assetId: np.id, quantity: "2", functionalAmount: "3000000" });

    const d = (await call("GET", "/dashboard", u.token)).json;
    expect(d.netWorth).toBe("500000");
    expect(d.complete).toBe(false);
    expect(d.unpriced).toEqual([np.symbol]);
    const xau = d.holdings.find((h: any) => h.symbol === np.symbol); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(xau.value).toBeNull();
    expect(xau.quantity).toBe("2");
  });

  it("excludes archived and opted-out accounts from net worth", async () => {
    const u = await newUser();
    await account(u.token, { name: "Utama", kind: "bank", openingBalance: { assetId: ID["IDR"], quantity: "100" } });
    await account(u.token, { name: "Tak dihitung", kind: "bank", includeInNetWorth: false, openingBalance: { assetId: ID["IDR"], quantity: "900" } });
    const old = await account(u.token, { name: "Lama", kind: "cash", openingBalance: { assetId: ID["IDR"], quantity: "50" } });
    await call("POST", `/accounts/${old}/archive`, u.token);
    expect((await call("GET", "/dashboard", u.token)).json.netWorth).toBe("100");
  });

  it("isolates workspaces", async () => {
    const a = await newUser();
    await account(a.token, { name: "A", kind: "bank", openingBalance: { assetId: ID["IDR"], quantity: "777" } });
    const b = await newUser();
    expect((await call("GET", "/dashboard", b.token)).json.netWorth).toBe("0");
  });

  it("builds cashflow per month from transaction dates, and void removes the amount", async () => {
    const u = await newUser();
    const acc = await account(u.token, { name: "BCA", kind: "bank" });
    await income(u.token, acc, "IDR", "28500000");
    const exp = await call("POST", "/transactions", u.token, { type: "expense", accountId: acc, assetId: ID["IDR"], quantity: "86000" });
    const prev = new Date();
    prev.setUTCMonth(prev.getUTCMonth() - 1, 15);
    await income(u.token, acc, "IDR", "1000000", { occurredAt: prev.toISOString() });
    // a transfer is neither income nor expense
    const other = await account(u.token, { name: "GoPay", kind: "ewallet" });
    await call("POST", "/transactions", u.token, { type: "transfer", fromAccountId: acc, toAccountId: other, assetId: ID["IDR"], quantity: "500000" });

    let months = (await call("GET", "/dashboard/cashflow?months=3", u.token)).json.months as Array<Record<string, string>>;
    expect(months.length).toBe(3);
    const cur = months[2]!;
    expect(cur.income).toBe("28500000");
    expect(cur.expense).toBe("86000");
    expect(cur.net).toBe("28414000");
    expect(months[1]!.income).toBe("1000000");
    expect(months[0]!.income).toBe("0");

    await call("POST", `/transactions/${exp.json.transaction.id}/void`, u.token);
    months = (await call("GET", "/dashboard/cashflow?months=3", u.token)).json.months;
    expect(months[2]!.expense).toBe("0");
    expect(months[2]!.income).toBe("28500000");
  });

  it("records one net-worth snapshot per day and updates it in place", async () => {
    const u = await newUser();
    const acc = await account(u.token, { name: "BCA", kind: "bank", openingBalance: { assetId: ID["IDR"], quantity: "1000" } });
    await call("GET", "/dashboard", u.token);
    await income(u.token, acc, "IDR", "500");
    await call("GET", "/dashboard", u.token);

    const pts = (await call("GET", "/dashboard/history?days=7", u.token)).json.points as Array<Record<string, unknown>>;
    expect(pts.length).toBe(1);
    expect(pts[0]!.netWorth).toBe("1500");
    expect(pts[0]!.complete).toBe(true);
    expect(await services.dashboard.snapshotAll()).toBeGreaterThan(0);
    // snapshotAll walks every workspace in the database; a development database that has collected thousands of test users needs far longer than 30 s.
  }, 180_000);
});
