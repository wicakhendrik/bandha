import { and, asc, eq, ilike, or, type SQL } from "drizzle-orm";
import { assets, marketQuotesLatest, type Db } from "@bandha/db";
import { dec } from "@bandha/ledger";
import { HttpError } from "./errors";
import type { MarketDataService } from "./market/market.service";
import type { CoinSearchHit } from "./market/provider";
import { isUniqueViolation } from "./types";

/** Coins shown first in pickers, in this order. */
export const PRIORITY_COINS = ["BTC", "ETH", "USDT", "USDC", "SOL", "SUI", "TON", "TRX", "XLM", "XRP", "NEAR", "BNB", "DAI", "ADA", "DOGE", "BCH"];

export type AssetKind = "fiat" | "crypto" | "gold" | "stock";
export const isAssetKind = (v: string | undefined): v is AssetKind => v === "fiat" || v === "crypto" || v === "gold" || v === "stock";

export interface AssetItem {
  id: string;
  symbol: string;
  name: string;
  kind: string;
  decimals: number;
  /** Rupiah per unit, or null when no price is known. */
  price: string | null;
  /** CoinGecko slug for crypto, used to avoid showing a coin twice. */
  providerRef: string | null;
}

export interface CoinChoice {
  /** Set when the coin is already in the catalog. */
  assetId: string | null;
  coingeckoId: string;
  symbol: string;
  name: string;
  rank: number | null;
  price: string | null;
  thumb?: string;
}

const SEARCH_TTL_MS = 60_000;

export class AssetsService {
  private readonly searchCache = new Map<string, { at: number; hits: CoinSearchHit[] }>();

  constructor(private readonly db: Db, private readonly market: MarketDataService) {}

  private async idrAssetId(): Promise<string> {
    const [row] = await this.db.select({ id: assets.id }).from(assets).where(and(eq(assets.kind, "fiat"), eq(assets.symbol, "IDR")));
    if (!row) throw new Error("IDR asset is missing");
    return row.id;
  }

  /** Catalog with each asset's current rupiah price. Main coins first, then alphabetical; IDR leads the fiat list. */
  async list(opts: { kind?: AssetKind; q?: string; limit?: number } = {}): Promise<AssetItem[]> {
    const idr = await this.idrAssetId();
    // Wildcards in user input are neutralised so a search cannot become a pattern scan.
    const q = (opts.q ?? "").replace(/[%_]/g, " ").trim().slice(0, 40);
    const where: SQL[] = [];
    if (opts.kind) where.push(eq(assets.kind, opts.kind));
    if (q) where.push(or(ilike(assets.symbol, `%${q}%`), ilike(assets.name, `%${q}%`))!);

    const rows = await this.db
      .select({
        id: assets.id, symbol: assets.symbol, name: assets.name, kind: assets.kind, decimals: assets.decimals,
        providerRef: assets.providerRef, price: marketQuotesLatest.price,
      })
      .from(assets)
      .leftJoin(marketQuotesLatest, and(eq(marketQuotesLatest.assetId, assets.id), eq(marketQuotesLatest.quoteAssetId, idr)))
      .where(where.length ? and(...where) : undefined)
      .orderBy(asc(assets.kind), asc(assets.symbol));

    // Within stocks, Jakarta shares (".JK") come before US ones.
    const rank = (a: { id: string; symbol: string; kind: string; providerRef: string | null }) =>
      a.id === idr ? -2 : a.kind === "crypto" && PRIORITY_COINS.includes(a.symbol) ? PRIORITY_COINS.indexOf(a.symbol) : a.kind === "stock" && !a.providerRef?.endsWith(".JK") ? 1001 : 1000;
    const items = rows.map<AssetItem>((r) => ({ ...r, price: r.id === idr ? "1" : r.price ? dec(r.price).toFixed() : null }));
    items.sort((a, b) => a.kind.localeCompare(b.kind) || rank(a) - rank(b) || a.symbol.localeCompare(b.symbol));
    return items.slice(0, Math.min(opts.limit ?? 200, 300));
  }

  private async remoteSearch(q: string): Promise<CoinSearchHit[] | null> {
    const key = q.toLowerCase();
    const hit = this.searchCache.get(key);
    if (hit && Date.now() - hit.at < SEARCH_TTL_MS) return hit.hits;
    try {
      const hits = await this.market.searchCoins(q);
      if (this.searchCache.size > 200) this.searchCache.clear();
      this.searchCache.set(key, { at: Date.now(), hits });
      return hits;
    } catch {
      return null; // CoinGecko unavailable: the catalog still answers
    }
  }

  /**
   * Local catalog matches first, then every other coin CoinGecko knows. Coins already in the catalog
   * carry an assetId, the rest can be added with `addCrypto`.
   */
  async searchCrypto(query: string): Promise<{ coins: CoinChoice[]; remote: boolean }> {
    const q = query.trim();
    const local = await this.list({ kind: "crypto", q, limit: 30 });
    const coins: CoinChoice[] = local.map((a) => ({
      assetId: a.id, coingeckoId: a.providerRef ?? a.symbol.toLowerCase(), symbol: a.symbol, name: a.name, rank: null, price: a.price,
    }));
    const have = new Set(local.map((a) => a.providerRef));
    const remote = await this.remoteSearch(q);
    for (const h of remote ?? []) {
      if (have.has(h.id)) continue;
      coins.push({ assetId: null, coingeckoId: h.id, symbol: h.symbol, name: h.name, rank: h.rank, price: null, ...(h.thumb ? { thumb: h.thumb } : {}) });
    }
    return { coins: coins.slice(0, 40), remote: remote !== null };
  }

  /** Adds a CoinGecko coin to the catalog (idempotent) and fetches its price right away. */
  async addCrypto(coingeckoId: string): Promise<AssetItem> {
    const [existing] = await this.db.select().from(assets).where(and(eq(assets.kind, "crypto"), eq(assets.providerRef, coingeckoId)));
    if (!existing) {
      let hit: CoinSearchHit | null;
      try {
        hit = await this.market.lookupCoin(coingeckoId);
      } catch {
        throw new HttpError(400, "CoinGecko tidak dapat dihubungi, coba lagi sebentar");
      }
      if (!hit) throw new HttpError(404, "Koin tidak ditemukan di CoinGecko");
      try {
        await this.db.insert(assets).values({ symbol: hit.symbol, name: hit.name, kind: "crypto", decimals: 8, providerRef: coingeckoId });
      } catch (err) {
        if (isUniqueViolation(err)) throw new HttpError(409, `Simbol ${hit.symbol} sudah dipakai koin lain di katalog`);
        throw err;
      }
      try { await this.market.sync(); } catch { /* the scheduler will fill the price on its next run */ }
    }
    const [item] = (await this.list({ kind: "crypto", limit: 300 })).filter((a) => a.providerRef === coingeckoId);
    if (!item) throw new Error("Asset insert failed");
    return item;
  }
}
