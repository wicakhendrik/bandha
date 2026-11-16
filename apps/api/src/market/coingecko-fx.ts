import { dec } from "@bandha/ledger";
import type { FxProvider } from "./provider";

/**
 * Near-live foreign-exchange rates from CoinGecko's /exchange_rates. That endpoint quotes every currency against
 * one bitcoin and refreshes every few minutes, so rupiah per unit of X = value(IDR) / value(X). It tracks the market
 * much more closely than the once-a-day ECB reference fix, but it is derived from crypto prices rather than quoted by a bank,
 * so it is always cross-checked against a reference source (see LiveFxProvider).
 */
export class CoinGeckoFxProvider implements FxProvider {
  readonly name = "coingecko-fx";

  constructor(
    private readonly apiKey?: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly baseUrl = "https://api.coingecko.com/api/v3",
  ) {}

  async fetchIdrRates(codes: string[]): Promise<Record<string, string>> {
    const wanted = [...new Set(codes.filter((c) => /^[A-Z]{3}$/.test(c) && c !== "IDR"))];
    if (wanted.length === 0) return {};

    const res = await this.fetchFn(`${this.baseUrl}/exchange_rates`, {
      headers: { accept: "application/json", ...(this.apiKey ? { "x-cg-demo-api-key": this.apiKey } : {}) },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`CoinGecko responded ${res.status}`);

    const rates = ((await res.json()) as { rates?: Record<string, { value?: unknown; type?: unknown }> }).rates;
    const valueOf = (code: string): number | null => {
      const r = rates?.[code.toLowerCase()];
      return r && r.type === "fiat" && typeof r.value === "number" && Number.isFinite(r.value) && r.value > 0 ? r.value : null;
    };
    const idr = valueOf("IDR");
    if (idr === null) throw new Error("CoinGecko returned no IDR rate");

    const out: Record<string, string> = {};
    for (const code of wanted) {
      const v = valueOf(code);
      if (v !== null) out[code] = dec(String(idr)).div(dec(String(v))).toDecimalPlaces(10).toFixed();
    }
    return out;
  }
}
