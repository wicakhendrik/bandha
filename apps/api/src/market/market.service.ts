import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { assets, marketQuotesHistory, marketQuotesLatest, type Db } from "@bandha/db";
import { dec, type PriceQuote } from "@bandha/ledger";
import type { FxProvider, MarketDataProvider } from "./provider";

const QUOTE_CURRENCIES = ["IDR", "USD"];
const FX_PREFIX = "fx:";

type QuoteRow = typeof marketQuotesLatest.$inferInsert;

export interface SyncResult {
  updated: number;
  /** Names of providers that failed this round. Prices from the others are still saved. */
  failed: string[];
}

export class MarketDataService {
  private inflight: Promise<SyncResult> | null = null;

  constructor(private readonly db: Db, private readonly provider: MarketDataProvider, private readonly fx: FxProvider) {}

  /**
   * Prices come from two sources: CoinGecko (crypto and gold) and an FX provider (foreign currencies).
   * One failing does not discard the other. Crypto is stored in BOTH IDR and USD as separate rows
   * (one row per asset and quote currency), so one can never overwrite the other. Concurrent calls share one run.
   */
  sync(): Promise<SyncResult> {
    this.inflight ??= this.doSync().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async doSync(): Promise<SyncResult> {
    const priced = await this.db.select().from(assets).where(isNotNull(assets.providerRef));
    const quoteAssets = await this.db
      .select()
      .from(assets)
      .where(and(eq(assets.kind, "fiat"), inArray(assets.symbol, QUOTE_CURRENCIES)));
    const quoteIdByCode = new Map(quoteAssets.map((a) => [a.symbol.toLowerCase(), a.id]));
    if (priced.length === 0 || quoteIdByCode.size === 0) return { updated: 0, failed: [] };
    const idrId = quoteIdByCode.get("idr");
    const asOf = new Date();

    const cgAssets = priced.filter((a) => a.providerRef && !a.providerRef.startsWith(FX_PREFIX));
    const fxAssets = priced.filter((a) => a.providerRef?.startsWith(FX_PREFIX));

    const crypto = async (): Promise<QuoteRow[]> => {
      const codes = [...quoteIdByCode.keys()];
      const prices = await this.provider.fetchPrices(cgAssets.flatMap((a) => (a.providerRef ? [a.providerRef] : [])), codes);
      return cgAssets.flatMap((a) =>
        codes.flatMap((code) => {
          const raw = a.providerRef ? prices[a.providerRef]?.[code] : undefined;
          const quoteAssetId = quoteIdByCode.get(code);
          if (!raw || !quoteAssetId) return [];
          // Gold is quoted per troy ounce but held in grams: divide by the asset's unit divisor.
          const price = dec(raw).div(dec(a.unitDivisor)).toDecimalPlaces(10).toFixed();
          return [{ assetId: a.id, quoteAssetId, price, source: this.provider.name, asOf }];
        }),
      );
    };

    const fiat = async (): Promise<QuoteRow[]> => {
      if (!idrId || fxAssets.length === 0) return [];
      const codes = fxAssets.map((a) => a.symbol);
      const rates = await this.fx.fetchIdrRates(codes);
      return fxAssets.flatMap((a) => (rates[a.symbol] ? [{ assetId: a.id, quoteAssetId: idrId, price: rates[a.symbol]!, source: this.fx.name, asOf }] : []));
    };

    const [c, f] = await Promise.allSettled([cgAssets.length ? crypto() : Promise.resolve([]), fiat()]);
    const failed = [c.status === "rejected" ? this.provider.name : "", f.status === "rejected" ? this.fx.name : ""].filter(Boolean);
    if (c.status === "rejected" && f.status === "rejected") throw c.reason;

    const rows = [...(c.status === "fulfilled" ? c.value : []), ...(f.status === "fulfilled" ? f.value : [])];
    if (rows.length === 0) return { updated: 0, failed };

    await this.db.transaction(async (tx) => {
      await tx
        .insert(marketQuotesLatest)
        .values(rows)
        .onConflictDoUpdate({
          target: [marketQuotesLatest.assetId, marketQuotesLatest.quoteAssetId],
          set: { price: sql`excluded.price`, source: sql`excluded.source`, asOf: sql`excluded.as_of` },
        });
      await tx.insert(marketQuotesHistory).values(rows);
    });
    return { updated: rows.length, failed };
  }

  /** Used by user-triggered refresh: avoids hammering the providers when prices are already fresh. */
  async refreshIfStale(maxAgeMs: number): Promise<SyncResult & { skipped: boolean }> {
    const [row] = await this.db.select({ latest: sql<Date | null>`max(${marketQuotesLatest.asOf})` }).from(marketQuotesLatest);
    if (row?.latest && Date.now() - new Date(row.latest).getTime() < maxAgeMs) return { updated: 0, failed: [], skipped: true };
    return { ...(await this.sync()), skipped: false };
  }

  /** Every latest quote with its quote-currency symbol. Callers pick the functional currency. */
  async latestQuotes(): Promise<PriceQuote[]> {
    const quote = alias(assets, "quote");
    return this.db
      .select({
        assetId: marketQuotesLatest.assetId,
        quoteSymbol: quote.symbol,
        price: marketQuotesLatest.price,
        asOf: marketQuotesLatest.asOf,
      })
      .from(marketQuotesLatest)
      .innerJoin(quote, eq(quote.id, marketQuotesLatest.quoteAssetId));
  }

  searchCoins(query: string) { return this.provider.search(query); }
  lookupCoin(id: string) { return this.provider.lookup(id); }
}
