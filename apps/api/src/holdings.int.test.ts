import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedAssets } from "@bandha/db";
import { assetIds, call, createUnpricedAsset, db, newUser, pool, services, type Json } from "./test-utils";

let ID: Record<string, string> = {};

beforeAll(async () => {
  await seedAssets(db);
  await services.market.sync(); // fake provider: BTC Rp 1.500.000.000, USDT Rp 16.200
  ID = await assetIds((await newUser()).token);
});
afterAll(async () => { await pool.end(); });

const mk = async (token: string, body: Json) => (await call("POST", "/accounts", token, body)).json.account.id as string;
const idr = (q: string) => ({ assetId: ID["IDR"], quantity: q });

/** BCA (bank, brand bca) 20jt, GoPay 500rb, Indodax (exchange) holding 0.01 BTC and 100 USDT. */
async function scenario() {
  const u = await newUser();
  const bca = await mk(u.token, { name: "Tabungan BCA", kind: "bank", brandKey: "bca", openingBalance: idr("20000000") });
  const gopay = await mk(u.token, { name: "GoPay", kind: "ewallet", openingBalance: idr("500000") });
  const dax = await mk(u.token, { name: "Indodax", kind: "exchange" });
  await call("POST", "/transactions", u.token, { type: "buy", accountId: dax, fundingAccountId: bca, assetId: ID["BTC"], quantity: "0.01", totalCost: "9500000", fee: "25000" });
  await call("POST", "/transactions", u.token, { type: "income", accountId: dax, assetId: ID["USDT"], quantity: "100", functionalAmount: "1600000" });
  return { u, bca, gopay, dax };
}

describe("holdings per asset (Aset screen)", () => {
  it("sums each asset across accounts, values it, and lists the accounts that hold it", async () => {
    const { u, bca, gopay, dax } = await scenario();
    const h = (await call("GET", "/holdings", u.token)).json;

    expect(h.assets.map((a: Json) => a.symbol)).toEqual(["BTC", "IDR", "USDT"]); // by value, descending
    const btc = h.assets[0];
    expect(btc).toMatchObject({ quantity: "0.01", price: "1500000000", value: "15000000" });
    expect(btc.accounts).toHaveLength(1);
    expect(btc.accounts[0]).toMatchObject({ accountId: dax, name: "Indodax", quantity: "0.01", value: "15000000" });

    // IDR is held in two accounts and is valued 1:1; the bigger account comes first
    const rp = h.assets[1];
    expect(rp).toMatchObject({ quantity: "10975000", value: "10975000" }); // 20.000.000 - 9.500.000 - 25.000 fee + 500.000
    expect(rp.accounts.map((a: Json) => [a.accountId, a.quantity])).toEqual([[bca, "10475000"], [gopay, "500000"]]);
    expect(rp.accounts[0].brandKey).toBe("bca");

    // USDT is valued at its IDR quote (16.200), never its USD quote
    expect(h.assets[2]).toMatchObject({ symbol: "USDT", price: "16200", value: "1620000" });
    expect(h.totalValue).toBe("27595000");
    expect(h.complete).toBe(true);
  });

  it("keeps an unpriced asset with its quantity and no value", async () => {
    const u = await newUser();
    const gold = await mk(u.token, { name: "Emas", kind: "gold" });
    const np = await createUnpricedAsset();
    await call("POST", "/transactions", u.token, { type: "income", accountId: gold, assetId: np.id, quantity: "5", functionalAmount: "10000000" });
    const h = (await call("GET", "/holdings", u.token)).json;
    expect(h.assets[0]).toMatchObject({ symbol: np.symbol, quantity: "5", price: null, value: null });
    expect(h.complete).toBe(false);
    expect(h.unpriced).toEqual([np.symbol]);
  });

  it("excludes archived accounts and other users' data", async () => {
    const { u, gopay } = await scenario();
    await call("POST", `/accounts/${gopay}/archive`, u.token);
    const idrRow = ((await call("GET", "/holdings", u.token)).json.assets as Json[]).find((a) => a.symbol === "IDR")!;
    expect(idrRow.accounts).toHaveLength(1);
    const other = await newUser();
    expect((await call("GET", "/holdings", other.token)).json.assets).toEqual([]);
    expect((await call("GET", "/holdings", null)).status).toBe(401);
  });
});

describe("account ledger (statement)", () => {
  it("lists movements newest first with a running balance that ends at the account balance", async () => {
    const { u, bca } = await scenario();
    await call("POST", "/transactions", u.token, { type: "expense", accountId: bca, assetId: ID["IDR"], quantity: "86000", description: "Kopi" });

    const l = (await call("GET", `/accounts/${bca}/ledger`, u.token)).json;
    expect(l.account).toMatchObject({ id: bca, name: "Tabungan BCA", brandKey: "bca" });
    // newest first: expense, buy (cost + fee merged into ONE line), opening balance
    expect(l.rows.map((r: Json) => r.type)).toEqual(["expense", "buy", "opening"]);
    expect(l.rows.map((r: Json) => r.quantity)).toEqual(["-86000", "-9525000", "20000000"]);
    expect(l.rows.map((r: Json) => r.balance)).toEqual(["10389000", "10475000", "20000000"]);
    expect(l.balances[0]).toMatchObject({ symbol: "IDR", quantity: "10389000" });
    expect(l.rows[0].balance).toBe(l.balances[0].quantity); // last running balance == current balance
    expect(l.totalValue).toBe("10389000");
  });

  it("can be limited to one asset, and shows only that asset's movements", async () => {
    const { u, dax } = await scenario();
    const all = (await call("GET", `/accounts/${dax}/ledger`, u.token)).json;
    expect(all.rows.map((r: Json) => r.symbol).sort()).toEqual(["BTC", "USDT"]);
    expect(all.asset).toBeNull();

    const btc = (await call("GET", `/accounts/${dax}/ledger?assetId=${ID["BTC"]}`, u.token)).json;
    expect(btc.asset).toMatchObject({ symbol: "BTC" });
    expect(btc.rows).toHaveLength(1);
    expect(btc.rows[0]).toMatchObject({ type: "buy", symbol: "BTC", quantity: "0.01", functionalAmount: "9500000", balance: "0.01" });

    const usdt = (await call("GET", `/accounts/${dax}/ledger?assetId=${ID["USDT"]}`, u.token)).json;
    expect(usdt.rows).toHaveLength(1);
    expect(usdt.rows[0]).toMatchObject({ quantity: "100", balance: "100" });
  });

  it("leaves voided transactions out entirely and keeps the balance consistent", async () => {
    const { u, bca } = await scenario();
    const e = (await call("POST", "/transactions", u.token, { type: "expense", accountId: bca, assetId: ID["IDR"], quantity: "86000" })).json.transaction.id;
    await call("POST", `/transactions/${e}/void`, u.token);
    const l = (await call("GET", `/accounts/${bca}/ledger`, u.token)).json;
    expect(l.rows.map((r: Json) => r.type)).toEqual(["buy", "opening"]);
    expect(l.rows[0].balance).toBe(l.balances[0].quantity);
  });

  it("shows transfers on both accounts with opposite signs", async () => {
    const { u, bca, gopay } = await scenario();
    await call("POST", "/transactions", u.token, { type: "transfer", fromAccountId: bca, toAccountId: gopay, assetId: ID["IDR"], quantity: "1000000" });
    const from = (await call("GET", `/accounts/${bca}/ledger`, u.token)).json.rows[0];
    const to = (await call("GET", `/accounts/${gopay}/ledger`, u.token)).json.rows[0];
    expect(from).toMatchObject({ type: "transfer", quantity: "-1000000" });
    expect(to).toMatchObject({ type: "transfer", quantity: "1000000", balance: "1500000" });
  });

  it("paginates", async () => {
    const { u, bca } = await scenario(); // BCA has two lines: the buy and the opening balance
    const first = (await call("GET", `/accounts/${bca}/ledger?limit=1`, u.token)).json;
    expect(first.rows.map((r: Json) => r.type)).toEqual(["buy"]);
    expect(first.hasMore).toBe(true);
    const second = (await call("GET", `/accounts/${bca}/ledger?limit=1&offset=1`, u.token)).json;
    expect(second.rows.map((r: Json) => r.type)).toEqual(["opening"]);
    expect(second.hasMore).toBe(false);
    // the running balance does not depend on the page: it is computed over the whole statement
    expect(second.rows[0].balance).toBe("20000000");
    expect((await call("GET", `/accounts/${bca}/ledger?limit=1&offset=2`, u.token)).json.rows).toEqual([]);
  });

  it("is isolated per workspace and validates its input", async () => {
    const { u, bca } = await scenario();
    const other = await newUser();
    expect((await call("GET", `/accounts/${bca}/ledger`, other.token)).status).toBe(404);
    expect((await call("GET", "/accounts/not-a-uuid/ledger", u.token)).status).toBe(404);
    expect((await call("GET", `/accounts/${bca}/ledger?assetId=nope`, u.token)).status).toBe(400);
    expect((await call("GET", `/accounts/${bca}/ledger`, null)).status).toBe(401);
  });
});

describe("account brand", () => {
  it("is stored, listed, updatable and clearable; invalid keys are rejected", async () => {
    const u = await newUser();
    expect((await call("POST", "/accounts", u.token, { name: "X", kind: "bank", brandKey: "BCA!" })).status).toBe(400);
    const id = await mk(u.token, { name: "Rekening gaji", kind: "bank", brandKey: "mandiri" });
    const list = async () => ((await call("GET", "/accounts", u.token)).json.accounts as Json[]).find((a) => a.id === id)!;
    expect((await list()).brandKey).toBe("mandiri");

    expect((await call("PATCH", `/accounts/${id}`, u.token, { brandKey: "bni" })).status).toBe(200);
    expect((await list()).brandKey).toBe("bni");
    expect((await call("PATCH", `/accounts/${id}`, u.token, { brandKey: null })).status).toBe(200);
    expect((await list()).brandKey).toBeNull();

    const none = await mk(u.token, { name: "Kas", kind: "cash" });
    expect(((await call("GET", "/accounts", u.token)).json.accounts as Json[]).find((a) => a.id === none)!.brandKey).toBeNull();
  });
});
