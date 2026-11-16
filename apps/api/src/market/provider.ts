import { dec } from "@bandha/ledger";

/** Prices keyed by provider reference, then by lowercase currency code ("idr", "usd"), as decimal strings. */
export type PriceMap = Record<string, Record<string, string>>;

export interface CoinSearchHit {
  /** CoinGecko slug, e.g. "near". */
  id: string;
  symbol: string;
  name: string;
  rank: number | null;
  thumb?: string;
}

export interface MarketDataProvider {
  readonly name: string;
  fetchPrices(refs: string[], currencies: string[]): Promise<PriceMap>;
  /** Free-text search over every coin the provider knows. */
  search(query: string): Promise<CoinSearchHit[]>;
  /** Exact lookup by slug; null when it does not exist. */
  lookup(id: string): Promise<CoinSearchHit | null>;
}

/** Foreign-exchange rates, expressed as rupiah per one unit of each currency. */
export interface FxProvider {
  readonly name: string;
  fetchIdrRates(codes: string[]): Promise<Record<string, string>>;
  /** Which source produced the rate just returned for `code` (providers that mix sources); defaults to `name`. */
  sourceFor?(code: string): string;
}

/** Normalises a provider number to a plain decimal string; rejects anything non-positive or non-finite. */
export function toPrice(raw: unknown): string | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return null;
  return dec(String(raw)).toFixed();
}
