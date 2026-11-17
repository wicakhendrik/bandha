import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedAssets } from "@bandha/db";
import { assetIds, call, db, newUser, pool, services, type Json } from "./test-utils";

let ID: Record<string, string> = {};

beforeAll(async () => {
  await seedAssets(db);
  const r = await services.market.sync(); // fake sources: BBCA = Rp 9.000, AAPL = US$ 200, USD = Rp 16.200
  expect(r.failed).toEqual([]);
  ID = await assetIds((await newUser()).token);
});
afterAll(async () => { await pool.end(); });

const stocks = async (token: string, q = "") => (await call("GET", `/assets?kind=stock&limit=300&q=${q}`, token)).json.assets as Json[];

describe("stocks in the catalog", () => {
  it("offers Indonesian and US shares as the 'stock' kind, with rupiah prices", async () => {
    const u = await newUser();
    const all = await stocks(u.token);
    expect(all.length).toBeGreaterThan(80);
    expect(all.every((a) => a.kind === "stock")).toBe(true);
    const bbca = all.find((a) => a.symbol === "BBCA") as Json;
    expect(bbca).toMatchObject({ name: "Bank Central Asia", decimals: 0, providerRef: "yf:BBCA.JK", price: "9000" });
    const aapl = all.find((a) => a.symbol === "AAPL") as Json;
    expect(aapl).toMatchObject({ name: "Apple", decimals: 6, providerRef: "yf:AAPL", price: "3240000" }); // 200 x 16.200
    expect(all.find((a) => a.symbol === "BRK-B")).toBeDefined();
    // searchable by name as well as ticker
    expect((await stocks(u.token, "central")).map((a) => a.symbol)).toContain("BBCA");
    expect((await stocks(u.token, "apple")).map((a) => a.symbol)).toContain("AAPL");
  });

  it("seeding is idempotent: running it again adds nothing and keeps ids", async () => {
    const u = await newUser();
    const before = await stocks(u.token);
    await seedAssets(db);
    const after = await stocks(u.token);
    expect(after.length).toBe(before.length);
    expect(after.find((a) => a.symbol === "BBCA")?.id).toBe(before.find((a) => a.symbol === "BBCA")?.id);
  });

  it("a stock can be bought and is valued at its rupiah price, in the portfolio", async () => {
    const u = await newUser();
    const bank = (await call("POST", "/accounts", u.token, { name: "Stockbit", kind: "brokerage", openingBalance: { assetId: ID["IDR"], quantity: "20000000" } })).json.account.id as string;
    const bbca = (await stocks(u.token, "BBCA")).find((a) => a.symbol === "BBCA") as Json;
    const aapl = (await stocks(u.token, "AAPL")).find((a) => a.symbol === "AAPL") as Json;

    // 100 shares (one lot) of BBCA at Rp 8.500 and 2 Apple shares at about Rp 3.000.000
    expect((await call("POST", "/transactions", u.token, { type: "buy", accountId: bank, assetId: bbca.id, quantity: "100", totalCost: "850000" })).status).toBe(201);
    expect((await call("POST", "/transactions", u.token, { type: "buy", accountId: bank, assetId: aapl.id, quantity: "2", totalCost: "6000000" })).status).toBe(201);

    const p = (await call("GET", "/portfolio", u.token)).json;
    const pos = (sym: string) => (p.positions as Json[]).find((x) => x.symbol === sym) as Json;
    expect(pos("BBCA")).toMatchObject({ quantity: "100", costBasis: "850000", price: "9000", marketValue: "900000", unrealizedPnl: "50000" });
    expect(pos("AAPL")).toMatchObject({ quantity: "2", costBasis: "6000000", price: "3240000", marketValue: "6480000", unrealizedPnl: "480000" });
    expect(p.complete).toBe(true);
  });
});
