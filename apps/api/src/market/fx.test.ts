import { describe, expect, it } from "vitest";
import { CoinGeckoFxProvider } from "./coingecko-fx";
import { LiveFxProvider } from "./live-fx";
import type { FxProvider } from "./provider";

const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

// Values are "units of this currency per 1 BTC", exactly as CoinGecko's /exchange_rates reports them.
const rates = {
  rates: {
    btc: { name: "Bitcoin", unit: "BTC", value: 1, type: "crypto" },
    usd: { name: "US Dollar", unit: "$", value: 100000, type: "fiat" },
    idr: { name: "Indonesian Rupiah", unit: "Rp", value: 1_827_800_000, type: "fiat" },
    eur: { name: "Euro", unit: "€", value: 80000, type: "fiat" },
    eth: { name: "Ether", unit: "ETH", value: 30, type: "crypto" },
  },
};

describe("CoinGeckoFxProvider", () => {
  it("derives rupiah per unit as value(IDR) / value(X)", async () => {
    const out = await new CoinGeckoFxProvider(undefined, reply(rates)).fetchIdrRates(["USD", "EUR"]);
    expect(out).toEqual({ USD: "18278", EUR: "22847.5" });
  });

  it("skips unknown codes and never treats a crypto entry as a currency", async () => {
    const out = await new CoinGeckoFxProvider(undefined, reply(rates)).fetchIdrRates(["USD", "ETH", "XYZ", "usd", "IDR"]);
    expect(out).toEqual({ USD: "18278" });
  });

  it("makes no request when nothing is asked for", async () => {
    let calls = 0;
    const spy = (async () => { calls++; return new Response("{}"); }) as unknown as typeof fetch;
    expect(await new CoinGeckoFxProvider(undefined, spy).fetchIdrRates(["IDR"])).toEqual({});
    expect(calls).toBe(0);
  });

  it("fails when the payload has no usable IDR rate, or on a non-2xx response", async () => {
    await expect(new CoinGeckoFxProvider(undefined, reply({ rates: { usd: { value: 1, type: "fiat" } } })).fetchIdrRates(["USD"])).rejects.toThrow(/IDR/);
    await expect(new CoinGeckoFxProvider(undefined, reply({}, 429)).fetchIdrRates(["USD"])).rejects.toThrow(/429/);
  });

  it("sends the key as a header only when configured", async () => {
    let key: string | null = "unset";
    const spy = (async (_u: unknown, init?: RequestInit) => { key = new Headers(init?.headers).get("x-cg-demo-api-key"); return new Response(JSON.stringify(rates)); }) as unknown as typeof fetch;
    await new CoinGeckoFxProvider("secret", spy).fetchIdrRates(["USD"]);
    expect(key).toBe("secret");
    await new CoinGeckoFxProvider(undefined, spy).fetchIdrRates(["USD"]);
    expect(key).toBeNull();
  });
});

const fixed = (name: string, r: Record<string, string> | Error): FxProvider => ({
  name,
  fetchIdrRates: async (codes) => {
    if (r instanceof Error) throw r;
    return Object.fromEntries(codes.filter((c) => r[c]).map((c) => [c, r[c]!]));
  },
});

describe("LiveFxProvider", () => {
  it("prefers the live rate while it agrees with the reference", async () => {
    const fx = new LiveFxProvider(fixed("live", { USD: "18277" }), fixed("ecb", { USD: "18259" }));
    expect(await fx.fetchIdrRates(["USD"])).toEqual({ USD: "18277" });
    expect(fx.sourceFor("USD")).toBe("live");
  });

  it("falls back to the reference when the live rate is far off (a bad number must not reach the ledger)", async () => {
    const fx = new LiveFxProvider(fixed("live", { USD: "27000" }), fixed("ecb", { USD: "18259" }));
    expect(await fx.fetchIdrRates(["USD"])).toEqual({ USD: "18259" });
    expect(fx.sourceFor("USD")).toBe("ecb");
  });

  it("fills currencies the live source lacks from the reference, and labels each source", async () => {
    const fx = new LiveFxProvider(fixed("live", { USD: "18277" }), fixed("ecb", { USD: "18259", BGN: "9300" }));
    expect(await fx.fetchIdrRates(["USD", "BGN"])).toEqual({ USD: "18277", BGN: "9300" });
    expect([fx.sourceFor("USD"), fx.sourceFor("BGN")]).toEqual(["live", "ecb"]);
  });

  it("keeps working when one source is down, and throws only when both are", async () => {
    expect(await new LiveFxProvider(fixed("live", new Error("down")), fixed("ecb", { USD: "18259" })).fetchIdrRates(["USD"])).toEqual({ USD: "18259" });
    expect(await new LiveFxProvider(fixed("live", { USD: "18277" }), fixed("ecb", new Error("down"))).fetchIdrRates(["USD"])).toEqual({ USD: "18277" });
    await expect(new LiveFxProvider(fixed("live", new Error("a")), fixed("ecb", new Error("b"))).fetchIdrRates(["USD"])).rejects.toThrow("a");
  });

  it("reports the provider's own name for a code it has not priced", () => {
    expect(new LiveFxProvider(fixed("live", {}), fixed("ecb", {})).sourceFor("USD")).toBe("live");
  });
});
