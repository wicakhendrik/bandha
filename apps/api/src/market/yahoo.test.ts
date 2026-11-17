import { describe, expect, it } from "vitest";
import { YahooStockProvider } from "./yahoo";

const chart = (price: unknown, currency: unknown) => ({ chart: { result: [{ meta: { regularMarketPrice: price, currency } }] } });
const fetchBy = (map: Record<string, unknown>) =>
  (async (u: URL | string) => {
    const sym = decodeURIComponent(String(u).split("/chart/")[1]!.split("?")[0]!);
    return sym in map ? new Response(JSON.stringify(map[sym])) : new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;

describe("YahooStockProvider", () => {
  it("reads the last price and its currency for each symbol", async () => {
    const p = new YahooStockProvider(fetchBy({ "BBCA.JK": chart(9125, "IDR"), AAPL: chart(201.35, "USD") }));
    expect(await p.fetchQuotes(["BBCA.JK", "AAPL"])).toEqual({ "BBCA.JK": { price: "9125", currency: "IDR" }, AAPL: { price: "201.35", currency: "USD" } });
  });

  it("leaves out a symbol that fails or answers nonsense, but keeps the rest", async () => {
    const p = new YahooStockProvider(fetchBy({ AAPL: chart(201.35, "USD"), BAD: chart(0, "USD"), ODD: chart(5, "dollars") }));
    expect(await p.fetchQuotes(["AAPL", "MISSING", "BAD", "ODD"])).toEqual({ AAPL: { price: "201.35", currency: "USD" } });
  });

  it("reports an outage (nothing came back) instead of pretending there are no prices, and ignores odd symbols", async () => {
    await expect(new YahooStockProvider(fetchBy({})).fetchQuotes(["AAPL"])).rejects.toThrow(/no prices/);
    let calls = 0;
    const spy = (async () => { calls++; return new Response("{}"); }) as unknown as typeof fetch;
    expect(await new YahooStockProvider(spy).fetchQuotes(["../../etc", "a b"])).toEqual({});
    expect(calls).toBe(0);
  });
});
