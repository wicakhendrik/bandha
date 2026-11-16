import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ledgerEntries, seedAssets } from "@bandha/db";
import { assetIds, call, createUnpricedAsset, db, newUser, pool, services, type Json } from "./test-utils";

let ID: Record<string, string> = {};

beforeAll(async () => {
  await seedAssets(db);
  await services.market.sync(); // fake provider: BTC = Rp 1.500.000.000, ETH = Rp 46.000.000
  ID = await assetIds((await newUser()).token);
});
afterAll(async () => { await pool.end(); });

const mkAccount = async (token: string, name: string, kind: string, idr?: string) =>
  (await call("POST", "/accounts", token, { name, kind, ...(idr ? { openingBalance: { assetId: ID["IDR"], quantity: idr } } : {}) })).json.account.id as string;

const balance = async (token: string, accountId: string, symbol: string) =>
  ((await call("GET", "/accounts", token)).json.accounts as Json[]).find((a) => a.id === accountId)?.balances.find((b: Json) => b.symbol === symbol)?.quantity ?? "0";

const buy = (token: string, body: Json) => call("POST", "/transactions", token, { type: "buy", assetId: ID["BTC"], ...body });
const sell = (token: string, body: Json) => call("POST", "/transactions", token, { type: "sell", assetId: ID["BTC"], ...body });
const portfolio = async (token: string) => (await call("GET", "/portfolio", token)).json;
// May be undefined at runtime (asserted with toBeUndefined where a position must be gone).
const position = (p: Json, symbol: string): Json => (p.positions as Json[]).find((x) => x.symbol === symbol) as Json;

describe("portfolio: buy, sell, weighted-average cost", () => {
  it("buy books the asset at cost, charges the fee separately and values it at the IDR quote", async () => {
    const u = await newUser();
    const bca = await mkAccount(u.token, "BCA", "bank", "100000000");
    const ex = await mkAccount(u.token, "Indodax", "exchange");

    const r = await buy(u.token, { accountId: ex, fundingAccountId: bca, quantity: "0.01", totalCost: "9500000", fee: "25000" });
    expect(r.status).toBe(201);
    expect(await balance(u.token, ex, "BTC")).toBe("0.01");
    expect(await balance(u.token, bca, "IDR")).toBe("90475000"); // 100.000.000 - 9.500.000 - 25.000 fee

    const p = await portfolio(u.token);
    const btc = position(p, "BTC");
    expect(btc.quantity).toBe("0.01");
    expect(btc.costBasis).toBe("9500000"); // the fee is NOT part of the cost basis
    expect(btc.avgCost).toBe("950000000");
    expect(btc.price).toBe("1500000000");
    expect(btc.marketValue).toBe("15000000");
    expect(btc.unrealizedPnl).toBe("5500000");
    expect(btc.unrealizedPct).toBe("57.89");
    // Cash (IDR) is listed too, but it is kept out of the invested cost basis so the percentage stays meaningful.
    expect(p.totals).toMatchObject({
      marketValue: "105475000", investedValue: "15000000", cashValue: "90475000",
      costBasis: "9500000", unrealizedPnl: "5500000", unrealizedPct: "57.89", realizedPnl: "0",
    });
    const cash = position(p, "IDR");
    expect(cash).toMatchObject({ cash: true, quantity: "90475000", avgCost: "1", price: "1", marketValue: "90475000", unrealizedPnl: "0", unrealizedPct: null });
    expect(cash.accounts).toEqual([{ accountId: bca, name: "BCA", quantity: "90475000", costBasis: "90475000" }]);
    expect(btc.cash).toBe(false);
    expect(p.positions.map((x: Json) => x.symbol)).toEqual(["IDR", "BTC"]); // by market value
    expect(p.complete).toBe(true);

    // the fee is an expense in cashflow; the purchase itself is neither income nor expense
    const month = ((await call("GET", "/dashboard/cashflow?months=1", u.token)).json.months as Json[])[0] as Json;
    expect(month.expense).toBe("25000");
    expect(month.income).toBe("0");
  });

  it("averages cost across buys, realises P/L on sells, and keeps the realised amount out of income", async () => {
    const u = await newUser();
    const bca = await mkAccount(u.token, "BCA", "bank", "100000000");
    const ex = await mkAccount(u.token, "Indodax", "exchange");
    await buy(u.token, { accountId: ex, fundingAccountId: bca, quantity: "0.01", totalCost: "9500000" });
    await buy(u.token, { accountId: ex, fundingAccountId: bca, quantity: "0.01", totalCost: "10500000" });

    let btc = position(await portfolio(u.token), "BTC");
    expect(btc.quantity).toBe("0.02");
    expect(btc.costBasis).toBe("20000000");
    expect(btc.avgCost).toBe("1000000000"); // weighted average

    // sell 0.005 for 8.000.000: cost of that part is 5.000.000, so the gain is 3.000.000
    expect((await sell(u.token, { accountId: ex, receivingAccountId: bca, quantity: "0.005", proceeds: "8000000" })).status).toBe(201);
    let p = await portfolio(u.token);
    btc = position(p, "BTC");
    expect(btc.quantity).toBe("0.015");
    expect(btc.costBasis).toBe("15000000");
    expect(p.realized).toEqual([{ symbol: "BTC", realized: "3000000" }]);
    expect(await balance(u.token, bca, "IDR")).toBe("88000000"); // 100.000.000 - 20.000.000 + 8.000.000

    // a loss: sell another 0.005 for 4.000.000 against 5.000.000 cost
    await sell(u.token, { accountId: ex, receivingAccountId: bca, quantity: "0.005", proceeds: "4000000" });
    p = await portfolio(u.token);
    expect(p.totals.realizedPnl).toBe("2000000");
    expect(position(p, "BTC").quantity).toBe("0.01");

    // realised profit is not income
    const month = ((await call("GET", "/dashboard/cashflow?months=1", u.token)).json.months as Json[])[0] as Json;
    expect(month.income).toBe("0");

    // the ledger still nets to zero in functional currency
    const [sum] = await db.select({ s: sql<string>`sum(${ledgerEntries.functionalAmount})` }).from(ledgerEntries).where(eq(ledgerEntries.workspaceId, u.workspaceId));
    expect(Number(sum?.s)).toBe(0);
  });

  it("selling everything leaves no position and break-even posts no P/L", async () => {
    const u = await newUser();
    const acc = await mkAccount(u.token, "Broker", "brokerage", "100000000");
    await call("POST", "/transactions", u.token, { type: "buy", accountId: acc, assetId: ID["ETH"], quantity: "1", totalCost: "46000000" });
    expect((await sell(u.token, { accountId: acc, assetId: ID["ETH"], quantity: "1", proceeds: "46000000" })).status).toBe(201);
    const p = await portfolio(u.token);
    expect(position(p, "ETH")).toBeUndefined();
    expect(p.realized).toEqual([]);
    expect(await balance(u.token, acc, "IDR")).toBe("100000000");
  });

  it("rejects overselling, selling an unheld asset, and trading the functional currency", async () => {
    const u = await newUser();
    const acc = await mkAccount(u.token, "Ex", "exchange", "50000000");
    await buy(u.token, { accountId: acc, quantity: "0.01", totalCost: "9500000" });
    const over = await sell(u.token, { accountId: acc, quantity: "0.02", proceeds: "1000" });
    expect(over.status).toBe(400);
    expect(over.json.error).toMatch(/melebihi/);
    expect((await sell(u.token, { accountId: acc, assetId: ID["ETH"], quantity: "1", proceeds: "1000" })).status).toBe(400);
    expect((await buy(u.token, { accountId: acc, assetId: ID["IDR"], quantity: "1", totalCost: "1" })).status).toBe(400);
    expect((await buy(u.token, { accountId: acc, quantity: "0", totalCost: "1" })).status).toBe(400);
    expect((await buy(u.token, { accountId: acc, quantity: "1", totalCost: "-5" })).status).toBe(400);
  });

  it("two simultaneous sales cannot both spend the same coins", async () => {
    const u = await newUser();
    const acc = await mkAccount(u.token, "Ex", "exchange", "50000000");
    await buy(u.token, { accountId: acc, quantity: "0.01", totalCost: "9500000" });
    const [a, b] = await Promise.all([
      sell(u.token, { accountId: acc, quantity: "0.01", proceeds: "10000000" }),
      sell(u.token, { accountId: acc, quantity: "0.01", proceeds: "10000000" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    expect(await balance(u.token, acc, "BTC")).toBe("0");
  });

  it("transfers carry cost basis proportionally and realise nothing", async () => {
    const u = await newUser();
    const a = await mkAccount(u.token, "Exchange", "exchange", "50000000");
    const b = await mkAccount(u.token, "Wallet", "other");
    await buy(u.token, { accountId: a, quantity: "0.02", totalCost: "20000000" });
    // the client-supplied functionalAmount is ignored: the source's average cost decides
    const t = await call("POST", "/transactions", u.token, { type: "transfer", fromAccountId: a, toAccountId: b, assetId: ID["BTC"], quantity: "0.005", functionalAmount: "999" });
    expect(t.status).toBe(201);

    const p = await portfolio(u.token);
    const btc = position(p, "BTC");
    expect(btc.quantity).toBe("0.02");
    expect(btc.costBasis).toBe("20000000"); // total cost unchanged
    const legs = btc.accounts as Json[];
    expect(legs.find((l) => l.accountId === a)).toMatchObject({ quantity: "0.015", costBasis: "15000000" });
    expect(legs.find((l) => l.accountId === b)).toMatchObject({ quantity: "0.005", costBasis: "5000000" });
    expect(p.totals.realizedPnl).toBe("0");

    expect((await call("POST", "/transactions", u.token, { type: "transfer", fromAccountId: a, toAccountId: b, assetId: ID["BTC"], quantity: "1" })).status).toBe(400);
  });

  it("void restores the position, but is refused once the coins were sold or moved", async () => {
    const u = await newUser();
    const acc = await mkAccount(u.token, "Ex", "exchange", "50000000");
    const first = (await buy(u.token, { accountId: acc, quantity: "0.01", totalCost: "9500000" })).json.transaction.id as string;
    const s = (await sell(u.token, { accountId: acc, quantity: "0.004", proceeds: "7000000" })).json.transaction.id as string;

    // the buy's coins are partly sold: voiding it would leave a negative holding
    const blocked = await call("POST", `/transactions/${first}/void`, u.token);
    expect(blocked.status).toBe(409);
    expect(blocked.json.error).toMatch(/dijual atau dipindahkan/);
    expect(await balance(u.token, acc, "BTC")).toBe("0.006");

    // voiding the sale first brings the coins, the cost basis and the realised P/L back
    expect((await call("POST", `/transactions/${s}/void`, u.token)).status).toBe(204);
    let p = await portfolio(u.token);
    expect(position(p, "BTC")).toMatchObject({ quantity: "0.01", costBasis: "9500000" });
    expect(p.totals.realizedPnl).toBe("0");
    expect(await balance(u.token, acc, "IDR")).toBe("40500000");

    // now the buy can be voided too
    expect((await call("POST", `/transactions/${first}/void`, u.token)).status).toBe(204);
    p = await portfolio(u.token);
    expect(position(p, "BTC")).toBeUndefined();
    expect(await balance(u.token, acc, "IDR")).toBe("50000000");
  });

  it("is idempotent and isolated between users", async () => {
    const a = await newUser();
    const acc = await mkAccount(a.token, "Ex", "exchange", "50000000");
    const key = `buy-key-${Math.random().toString(36).slice(2)}`;
    const one = await buy(a.token, { accountId: acc, quantity: "0.01", totalCost: "9500000", idempotencyKey: key });
    const two = await buy(a.token, { accountId: acc, quantity: "0.01", totalCost: "9500000", idempotencyKey: key });
    expect([one.status, two.status]).toEqual([201, 200]);
    expect(await balance(a.token, acc, "BTC")).toBe("0.01");

    const b = await newUser();
    expect((await portfolio(b.token)).positions).toEqual([]);
    expect((await sell(b.token, { accountId: acc, quantity: "0.01", proceeds: "1000" })).status).toBe(404);
    expect((await buy(b.token, { accountId: acc, quantity: "0.01", totalCost: "1000" })).status).toBe(404);
  });

  it("keeps unpriced positions visible with their cost but no value", async () => {
    const u = await newUser();
    const acc = await mkAccount(u.token, "Emas", "gold", "20000000");
    const np = await createUnpricedAsset();
    await call("POST", "/transactions", u.token, { type: "buy", accountId: acc, assetId: np.id, quantity: "5", totalCost: "10000000" });
    const p = await portfolio(u.token);
    const xau = position(p, np.symbol);
    expect(xau).toMatchObject({ quantity: "5", costBasis: "10000000", avgCost: "2000000", price: null, marketValue: null, unrealizedPnl: null });
    expect(p.complete).toBe(false);
    expect(p.unpriced).toEqual([np.symbol]);
    // only the cash is valued; the unpriced gold keeps its cost but adds no market value
    expect(p.totals).toMatchObject({ marketValue: "10000000", investedValue: "0", cashValue: "10000000" });
    expect(position(p, "IDR")).toMatchObject({ cash: true, quantity: "10000000" });
  });
});
