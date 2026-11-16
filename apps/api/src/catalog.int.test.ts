import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedAssets } from "@bandha/db";
import { assetIds, call, db, newUser, pool, services, type Json } from "./test-utils";

let ID: Record<string, string> = {};

beforeAll(async () => {
  await seedAssets(db);
  await services.market.sync(); // fake providers: crypto + gold from "coingecko", rupiah-per-unit from the fake FX source
  ID = await assetIds((await newUser()).token);
});
afterAll(async () => { await pool.end(); });

const mk = async (token: string, body: Json) => (await call("POST", "/accounts", token, body)).json.account.id as string;
const list = async (token: string, qs = "") => (await call("GET", `/assets${qs}`, token)).json.assets as Json[];

describe("asset catalog", () => {
  it("filters by kind: fiat leads with IDR and holds many currencies, crypto has no fiat", async () => {
    const u = await newUser();
    const fiat = await list(u.token, "?kind=fiat");
    expect(fiat[0]!.symbol).toBe("IDR");
    expect(fiat.length).toBeGreaterThanOrEqual(30);
    expect(fiat.every((a) => a.kind === "fiat")).toBe(true);
    expect(fiat.map((a) => a.symbol)).toEqual(expect.arrayContaining(["USD", "EUR", "SGD", "JPY", "MYR"]));

    const crypto = await list(u.token, "?kind=crypto");
    expect(crypto.every((a) => a.kind === "crypto")).toBe(true);
    // the main coins come first, in the requested order
    expect(crypto.slice(0, 16).map((a) => a.symbol)).toEqual(
      ["BTC", "ETH", "USDT", "USDC", "SOL", "SUI", "TON", "TRX", "XLM", "XRP", "NEAR", "BNB", "DAI", "ADA", "DOGE", "BCH"],
    );
    expect((await list(u.token, "?kind=gold")).map((a) => a.symbol)).toEqual(["XAU"]);
  });

  it("searches by symbol or name, case-insensitively, and neutralises wildcards", async () => {
    const u = await newUser();
    expect((await list(u.token, "?kind=crypto&q=bit")).map((a) => a.symbol).sort()).toEqual(["BCH", "BTC"]);
    expect((await list(u.token, "?q=EUR")).some((a) => a.symbol === "EUR")).toBe(true);
    const wild = await list(u.token, "?kind=crypto&q=%25"); // "%" must not match everything as a pattern
    expect(wild.length).toBeGreaterThan(0); // an empty search returns the catalog
    expect(await list(u.token, "?kind=crypto&q=zzzznotacoin")).toEqual([]);
    expect((await call("GET", "/assets", null)).status).toBe(401);
  });
});

describe("prices for foreign currencies and gold", () => {
  it("stores rupiah-per-unit for fiat and per-gram for gold (quoted per troy ounce)", async () => {
    const u = await newUser();
    const price = async (sym: string, kind: string) => (await list(u.token, `?kind=${kind}&q=${sym}`)).find((a) => a.symbol === sym)!.price;
    expect(await price("USD", "fiat")).toBe("16200");
    expect(await price("EUR", "fiat")).toBe("18000");
    expect(await price("IDR", "fiat")).toBe("1");
    expect(await price("XAU", "gold")).toBe("1000000"); // 31.103.476,8 per ounce / 31,1034768 g
    expect(await price("BTC", "crypto")).toBe("1500000000");
  });

  it("values foreign currency and gold holdings in rupiah, with nothing left unpriced", async () => {
    const u = await newUser();
    const bank = await mk(u.token, { name: "Bank luar negeri", kind: "bank", openingBalance: { assetId: ID["USD"], quantity: "100", functionalAmount: "1600000" } });
    const gold = await mk(u.token, { name: "Emas Antam", kind: "gold", openingBalance: { assetId: ID["XAU"], quantity: "2", functionalAmount: "1900000" } });
    expect(bank && gold).toBeTruthy();

    const h = (await call("GET", "/holdings", u.token)).json;
    const usd = h.assets.find((a: Json) => a.symbol === "USD");
    const xau = h.assets.find((a: Json) => a.symbol === "XAU");
    expect(usd).toMatchObject({ quantity: "100", price: "16200", value: "1620000" });
    expect(xau).toMatchObject({ quantity: "2", price: "1000000", value: "2000000" });
    expect(h.complete).toBe(true);
    expect(h.totalValue).toBe("3620000");
  });

  it("one failing source does not discard the other source's prices", async () => {
    const failing = { name: "fake-fx", fetchIdrRates: async () => { throw new Error("down"); } };
    const { MarketDataService } = await import("./market/market.service");
    const { FakeProvider } = await import("./market/fake");
    const svc = new MarketDataService(db, new FakeProvider(), failing);
    const r = await svc.sync();
    expect(r.failed).toEqual(["fake-fx"]);
    expect(r.updated).toBeGreaterThan(0); // crypto and gold still saved
  });
});

describe("crypto search and on-demand listing", () => {
  it("finds catalog coins without duplicating them and offers coins from CoinGecko that are not yet listed", async () => {
    const u = await newUser();
    const near = (await call("GET", "/assets/crypto/search?q=near", u.token)).json;
    expect(near.remote).toBe(true);
    const nearHits = near.coins.filter((c: Json) => c.symbol === "NEAR");
    expect(nearHits).toHaveLength(1); // not listed twice
    expect(nearHits[0].assetId).not.toBeNull(); // already in the catalog

    const pepe = (await call("GET", "/assets/crypto/search?q=pepe", u.token)).json.coins.find((c: Json) => c.coingeckoId === "pepe");
    expect(pepe).toMatchObject({ symbol: "PEPE" });
    // either not listed yet (assetId null) or listed by an earlier run; both are valid
    expect(["string", "object"]).toContain(typeof pepe.assetId);

    expect((await call("GET", "/assets/crypto/search?q=a", u.token)).json.coins).toEqual([]); // too short to search
    expect((await call("GET", "/assets/crypto/search?q=near", null)).status).toBe(401);
  });

  it("adds a coin to the catalog once, then offers it like any other", async () => {
    const u = await newUser();
    const first = await call("POST", "/assets/crypto", u.token, { coingeckoId: "bonk" });
    expect(first.status).toBe(201);
    expect(first.json.asset).toMatchObject({ symbol: "BONK", kind: "crypto", providerRef: "bonk" });

    const again = await call("POST", "/assets/crypto", u.token, { coingeckoId: "bonk" });
    expect(again.json.asset.id).toBe(first.json.asset.id); // idempotent
    expect((await list(u.token, "?kind=crypto&q=bonk")).map((a) => a.id)).toEqual([first.json.asset.id]);

    // once listed, search reports it as already in the catalog
    const hit = (await call("GET", "/assets/crypto/search?q=bonk", u.token)).json.coins.find((c: Json) => c.coingeckoId === "bonk");
    expect(hit.assetId).toBe(first.json.asset.id);
  });

  it("rejects unknown coins and malformed ids", async () => {
    const u = await newUser();
    expect((await call("POST", "/assets/crypto", u.token, { coingeckoId: "this-coin-does-not-exist" })).status).toBe(404);
    expect((await call("POST", "/assets/crypto", u.token, { coingeckoId: "Bad Id!" })).status).toBe(400);
    expect((await call("POST", "/assets/crypto", u.token, {})).status).toBe(400);
    expect((await call("POST", "/assets/crypto", null, { coingeckoId: "bonk" })).status).toBe(401);
  });
});

describe("account types", () => {
  it("supports the crypto wallet type and lets an account's type, name and brand be edited", async () => {
    const u = await newUser();
    const id = await mk(u.token, { name: "MetaMask", kind: "wallet", brandKey: "metamask" });
    const acc = async () => ((await call("GET", "/accounts", u.token)).json.accounts as Json[]).find((a) => a.id === id)!;
    expect(await acc()).toMatchObject({ kind: "wallet", brandKey: "metamask" });

    expect((await call("PATCH", `/accounts/${id}`, u.token, { name: "Dompet utama", kind: "exchange", brandKey: "binance" })).status).toBe(200);
    expect(await acc()).toMatchObject({ name: "Dompet utama", kind: "exchange", brandKey: "binance" });

    expect((await call("PATCH", `/accounts/${id}`, u.token, { kind: "equity" })).status).toBe(400); // system kinds are not user choices
    expect((await call("POST", "/accounts", u.token, { name: "X", kind: "pnl" })).status).toBe(400);
  });
});

describe("income and expense detail", () => {
  it("breaks a month down by category with percentages, and lists its transactions with their accounts", async () => {
    const u = await newUser();
    const bca = await mk(u.token, { name: "Tabungan BCA", kind: "bank", brandKey: "bca" });
    const post = (body: Json) => call("POST", "/transactions", u.token, { assetId: ID["IDR"], accountId: bca, ...body });
    await post({ type: "income", quantity: "28500000", category: "Gaji" });
    await post({ type: "income", quantity: "1000000", category: "Bonus" });
    await post({ type: "expense", quantity: "86000", category: "Makan", description: "Warung" });
    await post({ type: "expense", quantity: "14000", category: "Makan" });
    await post({ type: "expense", quantity: "50000", category: "Transport" });
    await post({ type: "expense", quantity: "10000" }); // no category

    const exp = (await call("GET", "/dashboard/cashflow/expense", u.token)).json;
    expect(exp).toMatchObject({ kind: "expense", total: "160000" });
    expect(exp.categories).toEqual([
      { category: "Makan", total: "100000", percent: "62.5" },
      { category: "Transport", total: "50000", percent: "31.2" }, // half-even rounding, like every percentage in the app
      { category: null, total: "10000", percent: "6.2" },
    ]);
    expect(exp.transactions).toHaveLength(4);
    expect(exp.transactions[0]).toMatchObject({ account: { id: bca, name: "Tabungan BCA", brandKey: "bca" }, symbol: "IDR" });
    expect(exp.transactions.map((t: Json) => t.amount).sort()).toEqual(["10000", "14000", "50000", "86000"]); // positive amounts

    const inc = (await call("GET", "/dashboard/cashflow/income", u.token)).json;
    expect(inc.total).toBe("29500000");
    expect(inc.categories.map((c: Json) => c.category)).toEqual(["Gaji", "Bonus"]);
  });

  it("leaves out voided transactions, other months and transfers; counts a purchase fee as an expense", async () => {
    const u = await newUser();
    const bca = await mk(u.token, { name: "BCA", kind: "bank", openingBalance: { assetId: ID["IDR"], quantity: "50000000" } });
    const dax = await mk(u.token, { name: "Indodax", kind: "exchange" });
    const gopay = await mk(u.token, { name: "GoPay", kind: "ewallet" });
    const post = (body: Json) => call("POST", "/transactions", u.token, { assetId: ID["IDR"], ...body });

    const voided = (await post({ type: "expense", accountId: bca, quantity: "999000", category: "Salah" })).json.transaction.id;
    await call("POST", `/transactions/${voided}/void`, u.token);
    const last = new Date(); last.setUTCMonth(last.getUTCMonth() - 1, 10);
    await post({ type: "expense", accountId: bca, quantity: "777000", category: "Bulan lalu", occurredAt: last.toISOString() });
    await post({ type: "transfer", fromAccountId: bca, toAccountId: gopay, quantity: "5000000" });
    await call("POST", "/transactions", u.token, { type: "buy", accountId: dax, fundingAccountId: bca, assetId: ID["BTC"], quantity: "0.01", totalCost: "9500000", fee: "25000" });

    const exp = (await call("GET", "/dashboard/cashflow/expense", u.token)).json;
    expect(exp.total).toBe("25000"); // only the purchase fee; the purchase itself, the transfer, the void and last month are not expenses
    expect(exp.transactions).toHaveLength(1);
    expect(exp.transactions[0]).toMatchObject({ type: "buy", amount: "25000", account: { id: bca, name: "BCA" } });

    const prev = `${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, "0")}`;
    const old = (await call("GET", `/dashboard/cashflow/expense?month=${prev}`, u.token)).json;
    expect(old.total).toBe("777000");
    expect(old.categories[0]).toMatchObject({ category: "Bulan lalu" });
  });

  it("validates the month and the kind, and is isolated per user", async () => {
    const u = await newUser();
    expect((await call("GET", "/dashboard/cashflow/expense?month=2026-13", u.token)).status).toBe(400);
    expect((await call("GET", "/dashboard/cashflow/expense?month=nov-2026", u.token)).status).toBe(400);
    expect((await call("GET", "/dashboard/cashflow/other", u.token)).status).toBe(404);
    expect((await call("GET", "/dashboard/cashflow/expense", null)).status).toBe(401);
    const empty = (await call("GET", "/dashboard/cashflow/income", u.token)).json;
    expect(empty).toMatchObject({ total: "0", categories: [], transactions: [] });
  });
});
