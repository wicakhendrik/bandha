import { toPrice, type StockProvider, type StockQuote } from "./provider";

/**
 * Share prices from Yahoo Finance's public chart endpoint (no key). It is not an official API, so it can change or be
 * rate limited; every symbol is fetched on its own, and one that fails is simply left out (callers keep the last price).
 */
export class YahooStockProvider implements StockProvider {
  readonly name = "yahoo";

  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly baseUrl = "https://query1.finance.yahoo.com/v8/finance/chart",
    private readonly concurrency = 6,
  ) {}

  /** One try; a rate limit (429), a server error or a network failure gets a second try shortly after. */
  private async one(symbol: string): Promise<StockQuote | null> {
    try {
      return await this.once(symbol);
    } catch {
      await new Promise((r) => setTimeout(r, 400));
      return this.once(symbol);
    }
  }

  private async once(symbol: string): Promise<StockQuote | null> {
    const res = await this.fetchFn(`${this.baseUrl}/${encodeURIComponent(symbol)}?range=1d&interval=1d`, {
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; Bandha/1.0)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 429 || res.status >= 500) throw new Error(`Yahoo responded ${res.status}`);
    if (!res.ok) return null;
    const meta = ((await res.json()) as { chart?: { result?: Array<{ meta?: { regularMarketPrice?: unknown; currency?: unknown } }> } }).chart?.result?.[0]?.meta;
    const price = toPrice(meta?.regularMarketPrice);
    const currency = typeof meta?.currency === "string" ? meta.currency.toUpperCase() : "";
    return price && /^[A-Z]{3}$/.test(currency) ? { price, currency } : null;
  }

  async fetchQuotes(symbols: string[]): Promise<Record<string, StockQuote>> {
    const wanted = [...new Set(symbols.filter((s) => /^[A-Za-z0-9.^=-]{1,20}$/.test(s)))];
    const out: Record<string, StockQuote> = {};
    let next = 0;
    const worker = async () => {
      while (next < wanted.length) {
        const sym = wanted[next++]!;
        try {
          const q = await this.one(sym);
          if (q) out[sym] = q;
        } catch { /* leave this one out */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, wanted.length) }, worker));
    // Everything failed (offline, blocked): report it, so the sync can say the stock source is down.
    if (wanted.length > 0 && Object.keys(out).length === 0) throw new Error("Yahoo Finance returned no prices");
    return out;
  }
}
