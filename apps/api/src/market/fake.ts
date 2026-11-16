import type { CoinSearchHit, FxProvider, MarketDataProvider, PriceMap } from "./provider";

/** Deterministic prices for tests and offline development. Never use in production. */
const FAKE: PriceMap = {
  bitcoin: { idr: "1500000000", usd: "95000" },
  ethereum: { idr: "46000000", usd: "2900" },
  solana: { idr: "2500000", usd: "155" },
  tether: { idr: "16200", usd: "1" },
  "usd-coin": { idr: "16190", usd: "1" },
  near: { idr: "40000", usd: "2.5" },
  // 31,103,476.8 per troy ounce is exactly 1,000,000 per gram, which keeps test arithmetic readable.
  "pax-gold": { idr: "31103476.8", usd: "1920" },
};

const COINS: CoinSearchHit[] = [
  { id: "near", symbol: "NEAR", name: "NEAR Protocol", rank: 23 },
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin", rank: 1 },
  { id: "pepe", symbol: "PEPE", name: "Pepe", rank: 40 },
  { id: "bonk", symbol: "BONK", name: "Bonk", rank: 90 },
];

export class FakeProvider implements MarketDataProvider {
  readonly name = "fake";

  async fetchPrices(refs: string[], currencies: string[]): Promise<PriceMap> {
    const out: PriceMap = {};
    for (const ref of refs) {
      const row = FAKE[ref];
      if (!row) continue;
      for (const cur of currencies) {
        const p = row[cur];
        if (p) (out[ref] ??= {})[cur] = p;
      }
    }
    return out;
  }

  async search(query: string): Promise<CoinSearchHit[]> {
    const q = query.toLowerCase();
    return COINS.filter((c) => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q) || c.id.includes(q));
  }

  async lookup(id: string): Promise<CoinSearchHit | null> {
    return COINS.find((c) => c.id === id) ?? null;
  }
}

/** Fixed rupiah-per-unit rates for tests. */
export class FakeFxProvider implements FxProvider {
  readonly name = "fake-fx";
  async fetchIdrRates(codes: string[]): Promise<Record<string, string>> {
    const rates: Record<string, string> = { USD: "16200", EUR: "18000", SGD: "12000", JPY: "108", MYR: "3600" };
    return Object.fromEntries(codes.filter((c) => rates[c]).map((c) => [c, rates[c]!]));
  }
}
