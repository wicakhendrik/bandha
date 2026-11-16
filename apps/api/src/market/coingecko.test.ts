import { describe, expect, it } from "vitest";
import { CoinGeckoProvider } from "./coingecko";
import { toPrice } from "./provider";

const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("toPrice", () => {
  it("normalises numbers to plain decimals, including exponent notation", () => {
    expect(toPrice(1500000000)).toBe("1500000000");
    expect(toPrice(1e-7)).toBe("0.0000001");
  });
  it("rejects zero, negatives, NaN and non-numbers", () => {
    for (const bad of [0, -1, NaN, Infinity, "5", null, undefined]) expect(toPrice(bad)).toBeNull();
  });
});

describe("CoinGeckoProvider", () => {
  it("maps ids and currencies to decimal strings and keeps USD and IDR apart", async () => {
    const p = new CoinGeckoProvider(undefined, reply({ tether: { idr: 16200, usd: 1 }, bitcoin: { idr: 1.5e9, usd: 95000 } }));
    const out = await p.fetchPrices(["tether", "bitcoin"], ["idr", "usd"]);
    expect(out.tether).toEqual({ idr: "16200", usd: "1" });
    expect(out.bitcoin).toEqual({ idr: "1500000000", usd: "95000" });
  });

  it("drops invalid entries instead of failing the whole sync", async () => {
    const p = new CoinGeckoProvider(undefined, reply({ bitcoin: { idr: 0, usd: 95000 }, junk: "x" }));
    const out = await p.fetchPrices(["bitcoin", "junk", "missing"], ["idr", "usd"]);
    expect(out).toEqual({ bitcoin: { usd: "95000" } });
  });

  it("throws on a non-2xx response", async () => {
    await expect(new CoinGeckoProvider(undefined, reply({}, 429)).fetchPrices(["bitcoin"], ["idr"])).rejects.toThrow(/429/);
  });

  it("sends the key header only when configured, and never in the URL", async () => {
    let seen: { url: string; key: string | null } | undefined;
    const spy = (async (u: URL, init?: RequestInit) => {
      seen = { url: String(u), key: new Headers(init?.headers).get("x-cg-demo-api-key") };
      return new Response("{}");
    }) as unknown as typeof fetch;
    await new CoinGeckoProvider("secret-key", spy).fetchPrices(["bitcoin"], ["idr"]);
    expect(seen?.key).toBe("secret-key");
    expect(seen?.url).not.toContain("secret-key");
  });
});
