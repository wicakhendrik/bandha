import { and, eq, isNull, sql } from "drizzle-orm";
import { accounts, assets, ledgerEntries, workspaces, type Db } from "@bandha/db";
import { D, dec, pickPrice } from "@bandha/ledger";
import { HttpError } from "./errors";
import type { MarketDataService } from "./market/market.service";

const STALE_AFTER_MS = 6 * 3_600_000;

export interface PositionRow {
  assetId: string;
  symbol: string;
  name: string;
  kind: string;
  quantity: string;
  /** Weighted-average cost basis of what is still held (functional currency). */
  costBasis: string;
  avgCost: string;
  price: string | null;
  marketValue: string | null;
  unrealizedPnl: string | null;
  unrealizedPct: string | null;
  stale: boolean;
  /** True for the functional currency (IDR): cash is listed as a position but has no profit/loss. */
  cash: boolean;
  accounts: Array<{ accountId: string; name: string; quantity: string; costBasis: string }>;
}

export class PortfolioService {
  constructor(private readonly db: Db, private readonly market: MarketDataService) {}

  /**
   * Positions come straight from the ledger (quantity and cost basis are sums of immutable entries),
   * valued at the latest quote in the workspace functional currency. Unpriced positions keep their
   * cost but show no market value or P/L; they are never valued at zero.
   */
  async summary(workspaceId: string) {
    const [ws] = await this.db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    if (!ws) throw new HttpError(404, "Workspace tidak ditemukan");
    const cur = ws.functionalCurrency;

    const rows = await this.db
      .select({
        accountId: accounts.id,
        accountName: accounts.name,
        assetId: assets.id,
        symbol: assets.symbol,
        name: assets.name,
        kind: assets.kind,
        quantity: sql<string>`sum(${ledgerEntries.quantity})`,
        cost: sql<string>`sum(${ledgerEntries.functionalAmount})`,
      })
      .from(ledgerEntries)
      .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
      .innerJoin(assets, eq(assets.id, ledgerEntries.assetId))
      .where(and(eq(ledgerEntries.workspaceId, workspaceId), eq(accounts.isSystem, false), isNull(accounts.archivedAt)))
      .groupBy(accounts.id, accounts.name, assets.id, assets.symbol, assets.name, assets.kind)
      .having(sql`sum(${ledgerEntries.quantity}) <> 0`);

    // The functional currency (IDR) is shown too, as a "cash" position: it has a quantity and a value
    // but never profit/loss, and it is kept out of the invested cost basis so percentages stay meaningful.
    const held = rows;
    const quotes = await this.market.latestQuotes();
    const now = Date.now();

    const byAsset = new Map<string, PositionRow>();
    for (const r of held) {
      const cur0 = byAsset.get(r.assetId);
      const q = dec(r.quantity);
      const c = dec(r.cost);
      const leg = { accountId: r.accountId, name: r.accountName, quantity: q.toFixed(), costBasis: c.toFixed() };
      if (cur0) {
        cur0.quantity = dec(cur0.quantity).plus(q).toFixed();
        cur0.costBasis = dec(cur0.costBasis).plus(c).toFixed();
        cur0.accounts.push(leg);
      } else {
        byAsset.set(r.assetId, {
          assetId: r.assetId, symbol: r.symbol, name: r.name, kind: r.kind, quantity: q.toFixed(), costBasis: c.toFixed(),
          avgCost: "0", price: null, marketValue: null, unrealizedPnl: null, unrealizedPct: null, stale: false,
          cash: r.kind === "fiat" && r.symbol === cur, accounts: [leg],
        });
      }
    }

    let investedValue = new D(0);
    let cashValue = new D(0);
    let totalCostPriced = new D(0);
    const unpriced: string[] = [];
    const positions = [...byAsset.values()].map((p) => {
      const q = dec(p.quantity);
      p.avgCost = q.isZero() ? "0" : dec(p.costBasis).div(q).toDecimalPlaces(8).toFixed();
      if (p.cash) {
        p.avgCost = "1";
        p.price = "1";
        p.marketValue = q.toFixed();
        p.unrealizedPnl = "0";
        cashValue = cashValue.plus(q);
        return p;
      }
      const quote = pickPrice(quotes, p.assetId, cur);
      if (!quote) { unpriced.push(p.symbol); return p; }
      const value = q.times(dec(quote.price));
      const pnl = value.minus(dec(p.costBasis));
      p.price = dec(quote.price).toFixed();
      p.marketValue = value.toFixed();
      p.unrealizedPnl = pnl.toFixed();
      p.unrealizedPct = dec(p.costBasis).isPositive() ? pnl.div(dec(p.costBasis)).times(100).toFixed(2) : null;
      p.stale = now - quote.asOf.getTime() > STALE_AFTER_MS;
      investedValue = investedValue.plus(value);
      totalCostPriced = totalCostPriced.plus(dec(p.costBasis));
      return p;
    });
    positions.sort((a, b) => (b.marketValue === null ? -1 : a.marketValue === null ? 1 : dec(b.marketValue).comparedTo(dec(a.marketValue))));

    const realized = await this.realizedByAsset(workspaceId);
    const realizedTotal = realized.reduce((acc, r) => acc.plus(dec(r.realized)), new D(0));
    const unrealized = investedValue.minus(totalCostPriced);

    return {
      functionalCurrency: cur,
      complete: unpriced.length === 0,
      unpriced,
      totals: {
        /** Everything, cash included. */
        marketValue: investedValue.plus(cashValue).toFixed(),
        /** Priced assets other than cash. */
        investedValue: investedValue.toFixed(),
        cashValue: cashValue.toFixed(),
        /** Cost of the priced, non-cash assets; unrealised P/L and its percentage are measured against this. */
        costBasis: totalCostPriced.toFixed(),
        unrealizedPnl: unrealized.toFixed(),
        unrealizedPct: totalCostPriced.isPositive() ? unrealized.div(totalCostPriced).times(100).toFixed(2) : null,
        realizedPnl: realizedTotal.toFixed(),
      },
      positions,
      realized,
    };
  }

  /**
   * Realised P/L per asset: the sum of entries on the hidden P/L account, attributed to the asset that was
   * disposed of in the same journal (the one that LEFT an account in the original journal; a void's reversal journal
   * looks at the journal it reverses, so it nets back against the same asset even when two assets changed hands). Credits (gains) are stored negative, so the sign is flipped. Void reversals
   * are included, so a voided sale nets back to zero. Archived accounts still count.
   */
  private async realizedByAsset(workspaceId: string): Promise<Array<{ symbol: string; realized: string }>> {
    const res = await this.db.execute(sql`
      select s.symbol as symbol, (-sum(p.functional_amount))::text as realized
      from ledger_entries p
      join accounts pa on pa.id = p.account_id and pa.is_system and pa.kind = 'pnl'
      join journals pj on pj.id = p.journal_id
      join ledger_entries o on o.journal_id = coalesce(pj.reverses_journal_id, pj.id) and o.asset_id <> p.asset_id and o.quantity < 0
      join accounts oa on oa.id = o.account_id and not oa.is_system
      join assets s on s.id = o.asset_id
      where p.workspace_id = ${workspaceId}
      group by s.symbol
      order by s.symbol`);
    return (res.rows as Array<{ symbol: string; realized: string }>)
      .map((r) => ({ symbol: r.symbol, realized: dec(r.realized).toFixed() }))
      .filter((r) => !dec(r.realized).isZero());
  }
}
