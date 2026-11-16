import { toPrice, type CoinSearchHit, type MarketDataProvider, type PriceMap } from "./provider";

const SLUG = /^[a-z0-9-]{1,100}$/;

export class CoinGeckoProvider implements MarketDataProvider {
  readonly name = "coingecko";

  constructor(
    private readonly apiKey?: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly baseUrl = "https://api.coingecko.com/api/v3",
  ) {}

  private async get(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await this.fetchFn(url, {
      headers: { accept: "application/json", ...(this.apiKey ? { "x-cg-demo-api-key": this.apiKey } : {}) },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`CoinGecko responded ${res.status}`);
    return res.json();
  }

  async fetchPrices(refs: string[], currencies: string[]): Promise<PriceMap> {
    if (refs.length === 0) return {};
    const body = await this.get("/simple/price", { ids: refs.join(","), vs_currencies: currencies.join(","), precision: "full" });
    if (typeof body !== "object" || body === null) throw new Error("CoinGecko returned an unexpected payload");

    const out: PriceMap = {};
    for (const ref of refs) {
      const entry = (body as Record<string, unknown>)[ref];
      if (typeof entry !== "object" || entry === null) continue;
      for (const cur of currencies) {
        const price = toPrice((entry as Record<string, unknown>)[cur]);
        if (price) (out[ref] ??= {})[cur] = price;
      }
    }
    return out;
  }

  async search(query: string): Promise<CoinSearchHit[]> {
    const body = await this.get("/search", { query });
    const coins = (body as { coins?: unknown } | null)?.coins;
    if (!Array.isArray(coins)) return [];
    return coins.flatMap((c: Record<string, unknown>) =>
      typeof c.id === "string" && SLUG.test(c.id) && typeof c.symbol === "string" && typeof c.name === "string"
        ? [{
            id: c.id, symbol: c.symbol.toUpperCase(), name: c.name,
            rank: typeof c.market_cap_rank === "number" ? c.market_cap_rank : null,
            ...(typeof c.thumb === "string" ? { thumb: c.thumb } : {}),
          }]
        : [],
    ).slice(0, 25);
  }

  async lookup(id: string): Promise<CoinSearchHit | null> {
    if (!SLUG.test(id)) return null;
    const body = await this.get(`/coins/${id}`, {
      localization: "false", tickers: "false", market_data: "false", community_data: "false", developer_data: "false", sparkline: "false",
    });
    const c = body as Record<string, unknown> | null;
    if (!c || c.id !== id || typeof c.symbol !== "string" || typeof c.name !== "string") return null;
    return { id, symbol: c.symbol.toUpperCase(), name: c.name, rank: typeof c.market_cap_rank === "number" ? c.market_cap_rank : null };
  }
}
