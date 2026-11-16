import { dec, D } from "./decimal";

export interface HoldingInput {
  assetId: string;
  symbol: string;
  kind: string;
  quantity: string;
  /** True when the asset IS the workspace functional currency (price is exactly 1). */
  isFunctional: boolean;
}

export interface PriceQuote {
  assetId: string;
  /** Symbol of the currency the price is denominated in (e.g. "IDR", "USD"). */
  quoteSymbol: string;
  price: string;
  asOf: Date;
}

export interface ValuedHolding extends HoldingInput {
  price: string | null;
  /** Null = unknown. An unpriced holding is never valued at zero. */
  value: string | null;
  stale: boolean;
  priceAsOf: Date | null;
}

export interface Valuation {
  rows: ValuedHolding[];
  /** Sum of the values that are known. Check `complete` before presenting it as the full total. */
  total: string;
  /** False when at least one non-zero holding has no usable price. */
  complete: boolean;
  unpriced: string[];
}

/**
 * Select the price quoted in the functional currency. A quote in any other currency
 * (e.g. USD 1.00 for a stablecoin) is ignored, so it can never be read as IDR.
 */
export function pickPrice(quotes: readonly PriceQuote[], assetId: string, functionalSymbol: string): PriceQuote | null {
  return quotes.find((q) => q.assetId === assetId && q.quoteSymbol === functionalSymbol) ?? null;
}

export function valueHoldings(
  holdings: readonly HoldingInput[],
  quotes: readonly PriceQuote[],
  functionalSymbol: string,
  now: Date,
  staleAfterMs: number,
): Valuation {
  let total = new D(0);
  const unpriced: string[] = [];

  const rows = holdings.map<ValuedHolding>((h) => {
    if (h.isFunctional) {
      total = total.plus(dec(h.quantity));
      return { ...h, price: "1", value: dec(h.quantity).toFixed(), stale: false, priceAsOf: null };
    }
    const q = pickPrice(quotes, h.assetId, functionalSymbol);
    if (!q) {
      if (!dec(h.quantity).isZero()) unpriced.push(h.symbol);
      return { ...h, price: null, value: null, stale: false, priceAsOf: null };
    }
    const value = dec(h.quantity).times(dec(q.price));
    total = total.plus(value);
    return {
      ...h,
      price: dec(q.price).toFixed(),
      value: value.toFixed(),
      stale: now.getTime() - q.asOf.getTime() > staleAfterMs,
      priceAsOf: q.asOf,
    };
  });

  return { rows, total: total.toFixed(), complete: unpriced.length === 0, unpriced };
}

/**
 * Groups values by key, then returns each group's share of the positive total as a one-decimal
 * percentage string. Groups whose total is not positive are left out of the allocation.
 */
export function allocate(values: ReadonlyArray<{ key: string; value: string }>): Array<{ key: string; value: string; percent: string }> {
  const grouped = new Map<string, InstanceType<typeof D>>();
  for (const v of values) grouped.set(v.key, (grouped.get(v.key) ?? new D(0)).plus(dec(v.value)));

  const positive = [...grouped].filter(([, total]) => total.isPositive());
  const sum = positive.reduce((acc, [, total]) => acc.plus(total), new D(0));
  if (sum.isZero()) return [];
  return positive
    .map(([key, total]) => ({ key, value: total.toFixed(), percent: total.div(sum).times(100).toFixed(1) }))
    .sort((a, b) => dec(b.value).comparedTo(dec(a.value)));
}
