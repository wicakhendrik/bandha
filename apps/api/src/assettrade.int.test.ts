import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedAssets } from "@bandha/db";
import { assetIds, call, db, newUser, pool, services, type Json } from "./test-utils";

let ID: Record<string, string> = {};

beforeAll(async () => {
  await seedAssets(db);
  await services.market.sync(); // fake provider: BTC = Rp 1.500.000.000, USDT = Rp 16.200
  ID = await assetIds((await newUser()).token);
});
afterAll(async () => { await pool.end(); });

const mkAccount = async (token: string, name: string, kind: string, opening?: Json) =>
  (await call("POST", "/accounts", token, { name, kind, ...(opening ? { openingBalance: opening } : {}) })).json.account.id as string;

const balance = async (token: string, accountId: string, symbol: string) =>
  ((await call("GET", "/accounts", token)).json.accounts as Json[]).find((a) => a.id === accountId)?.balances.find((b: Json) => b.symbol === symbol)?.quantity ?? "0";

const portfolio = async (token: string) => (await call("GET", "/portfolio", token)).json;
const realizedOf = (p: Json, symbol: string) => ((p.realized as Json[]).find((r) => r.symbol === symbol) as Json | undefined)?.realized;
const position = (p: Json, symbol: string): Json => (p.positions as Json[]).find((x) => x.symbol === symbol) as Json;

/** An exchange account holding 1000 USDT that cost Rp 15.800 each (so paying with it realises a gain at today's Rp 16.200). */
async function exchangeWithUsdt() {
  const u = await newUser();
  const ex = await mkAccount(u.token, "Binance", "exchange", { assetId: ID["USDT"], quantity: "1000", functionalAmount: "15800000" });
  return { ...u, ex };
}

describe("buy paid with another asset (BTC with USDT)", () => {
  it("books one balanced journal: BTC at the value paid, USDT out at its average cost, fee as expense, gain as realised P/L", async () => {
    const u = await exchangeWithUsdt();
    const r = await call("POST", "/transactions", u.token, {
      type: "buy", accountId: u.ex, assetId: ID["BTC"], quantity: "0.005", totalCost: "8100000", payAssetId: ID["USDT"], payQuantity: "500", fee: "1",
    });
    expect(r.status).toBe(201);

    // bought and received in the same account; paid with USDT, plus the 1 USDT fee on top
    expect(await balance(u.token, u.ex, "BTC")).toBe("0.005");
    expect(await balance(u.token, u.ex, "USDT")).toBe("499");

    const p = await portfolio(u.token);
    expect(position(p, "BTC").costBasis).toBe("8100000"); // value of what was paid; the fee is not part of it
    expect(position(p, "USDT").costBasis).toBe("7884200"); // 499 x 15.800 remains at the original average cost
    // paying: worth 8.100.000 + fee 16.200, cost 501 x 15.800 = 7.915.800 -> gain 200.400, attributed to USDT only
    expect(realizedOf(p, "USDT")).toBe("200400");
    expect(realizedOf(p, "BTC")).toBeUndefined();
    expect(p.totals.realizedPnl).toBe("200400");

    const month = ((await call("GET", "/dashboard/cashflow?months=1", u.token)).json.months as Json[])[0] as Json;
    expect(month.expense).toBe("16200"); // the fee, valued at the same unit price
  });

  it("refuses to pay more than the account holds, or to pay for an asset with itself", async () => {
    const u = await exchangeWithUsdt();
    const base = { type: "buy", accountId: u.ex, assetId: ID["BTC"], quantity: "0.01", totalCost: "16200000", payAssetId: ID["USDT"] };
    const tooMuch = await call("POST", "/transactions", u.token, { ...base, payQuantity: "1000", fee: "1" }); // 1001 > 1000
    expect(tooMuch.status).toBe(400);
    expect(String(tooMuch.json.error ?? tooMuch.json.message)).toContain("tidak cukup");
    const same = await call("POST", "/transactions", u.token, { ...base, assetId: ID["USDT"], payQuantity: "5" });
    expect(same.status).toBe(400);
    const missing = await call("POST", "/transactions", u.token, { ...base });
    expect(missing.status).toBe(400); // payQuantity is required with payAssetId
    expect(await balance(u.token, u.ex, "USDT")).toBe("1000");
  });

  it("loads back for editing in the same shape, can be edited, and voiding nets the realised P/L to zero", async () => {
    const u = await exchangeWithUsdt();
    const created = await call("POST", "/transactions", u.token, {
      type: "buy", accountId: u.ex, assetId: ID["BTC"], quantity: "0.005", totalCost: "8100000", payAssetId: ID["USDT"], payQuantity: "500", fee: "1",
    });
    const id = created.json.transaction.id as string;

    const form = (await call("GET", `/transactions/${id}`, u.token)).json.transaction as Json;
    expect(form).toMatchObject({
      type: "buy", accountId: u.ex, fundingAccountId: u.ex, assetId: ID["BTC"], quantity: "0.005", totalCost: "8100000",
      payAssetId: ID["USDT"], payQuantity: "500", fee: "1",
    });

    // edit: pay 600 USDT worth 9.720.000 for 0.006 BTC
    const { id: _id, ...fields } = form;
    const edited = await call("PUT", `/transactions/${id}`, u.token, { ...fields, quantity: "0.006", payQuantity: "600", totalCost: "9720000" });
    expect(edited.status).toBe(204);
    expect(await balance(u.token, u.ex, "BTC")).toBe("0.006");
    expect(await balance(u.token, u.ex, "USDT")).toBe("399");

    const voided = await call("POST", `/transactions/${id}/void`, u.token);
    expect([200, 204]).toContain(voided.status);
    expect(await balance(u.token, u.ex, "BTC")).toBe("0");
    expect(await balance(u.token, u.ex, "USDT")).toBe("1000");
    const p = await portfolio(u.token);
    expect(realizedOf(p, "USDT")).toBeUndefined(); // gain and its reversal cancel out
    expect(p.totals.realizedPnl).toBe("0");
  });
});

describe("sell for another asset (BTC for USDT)", () => {
  it("removes BTC at average cost, receives USDT net of the fee at its value, and books the gain on BTC", async () => {
    const u = await newUser();
    const bca = await mkAccount(u.token, "BCA", "bank", { assetId: ID["IDR"], quantity: "100000000" });
    const ex = await mkAccount(u.token, "Binance", "exchange");
    await call("POST", "/transactions", u.token, { type: "buy", accountId: ex, fundingAccountId: bca, assetId: ID["BTC"], quantity: "0.01", totalCost: "9500000" });

    const r = await call("POST", "/transactions", u.token, {
      type: "sell", accountId: ex, assetId: ID["BTC"], quantity: "0.004", proceeds: "9720000", receiveAssetId: ID["USDT"], receiveQuantity: "600", fee: "1",
    });
    expect(r.status).toBe(201);
    expect(await balance(u.token, ex, "BTC")).toBe("0.006");
    expect(await balance(u.token, ex, "USDT")).toBe("599"); // 600 received, 1 taken as the fee

    const p = await portfolio(u.token);
    expect(position(p, "BTC").costBasis).toBe("5700000"); // 0.006 of the 9.500.000
    expect(position(p, "USDT").costBasis).toBe("9703800"); // 9.720.000 less the fee's value 16.200
    expect(realizedOf(p, "BTC")).toBe("5920000"); // 9.720.000 - 0.004 x 950.000.000
    expect(realizedOf(p, "USDT")).toBeUndefined();

    const form = (await call("GET", `/transactions/${r.json.transaction.id}`, u.token)).json.transaction as Json;
    expect(form).toMatchObject({ type: "sell", receivingAccountId: ex, receiveAssetId: ID["USDT"], receiveQuantity: "600", proceeds: "9720000", fee: "1", quantity: "0.004" });
  });

  it("refuses a fee that eats the whole amount, and selling more than is held", async () => {
    const u = await newUser();
    const bca = await mkAccount(u.token, "BCA", "bank", { assetId: ID["IDR"], quantity: "100000000" });
    const ex = await mkAccount(u.token, "Binance", "exchange");
    await call("POST", "/transactions", u.token, { type: "buy", accountId: ex, fundingAccountId: bca, assetId: ID["BTC"], quantity: "0.01", totalCost: "9500000" });
    const base = { type: "sell", accountId: ex, assetId: ID["BTC"], proceeds: "9720000", receiveAssetId: ID["USDT"], receiveQuantity: "600" };
    expect((await call("POST", "/transactions", u.token, { ...base, quantity: "0.004", fee: "600" })).status).toBe(400);
    expect((await call("POST", "/transactions", u.token, { ...base, quantity: "0.5" })).status).toBe(400);
  });
});

describe("expenses cannot spend a held asset the account does not have", () => {
  it("rejects an expense in a held asset beyond the balance, and allows it within", async () => {
    const u = await exchangeWithUsdt();
    const over = await call("POST", "/transactions", u.token, { type: "expense", accountId: u.ex, assetId: ID["USDT"], quantity: "1500", functionalAmount: "24300000" });
    expect(over.status).toBe(400);
    const ok = await call("POST", "/transactions", u.token, { type: "expense", accountId: u.ex, assetId: ID["USDT"], quantity: "100", functionalAmount: "1620000" });
    expect(ok.status).toBe(201);
    expect(await balance(u.token, u.ex, "USDT")).toBe("900");
  });
});
