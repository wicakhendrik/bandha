import { and, eq, isNull, sql } from "drizzle-orm";
import { accounts, assets, ledgerEntries, workspaces, type Db } from "@bandha/db";
import { D, dec, pickPrice, type PriceQuote } from "@bandha/ledger";
import { HttpError } from "./errors";
import { LIVE_J } from "./ledger-store";
import type { MarketDataService } from "./market/market.service";

const STALE_AFTER_MS = 6 * 3_600_000;

interface Priced { price: string | null; value: (qty: string) => string | null; stale: boolean }

/** Price of one unit in the workspace functional currency; the currency itself is exactly 1. */
function priceFor(
  a: { assetId: string; symbol: string; kind: string }, cur: string, quotes: PriceQuote[], now: number,
): Priced {
  if (a.kind === "fiat" && a.symbol === cur) return { price: "1", value: (q) => dec(q).toFixed(), stale: false };
  const quote = pickPrice(quotes, a.assetId, cur);
  if (!quote) return { price: null, value: () => null, stale: false };
  return {
    price: dec(quote.price).toFixed(),
    value: (q) => dec(q).times(dec(quote.price)).toFixed(),
    stale: now - quote.asOf.getTime() > STALE_AFTER_MS,
  };
}

const EDITABLE_TYPES = new Set(["income", "expense", "transfer", "buy", "sell", "opening"]);

export class HoldingsService {
  constructor(private readonly db: Db, private readonly market: MarketDataService) {}

  private async functionalCurrency(workspaceId: string): Promise<string> {
    const [ws] = await this.db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    if (!ws) throw new HttpError(404, "Workspace tidak ditemukan");
    return ws.functionalCurrency;
  }

  /**
   * The "Aset" screen: every asset the user holds, summed across all active accounts, with the
   * accounts that hold it. Fiat and crypto alike. Unpriced assets show quantity but no value.
   */
  async byAsset(workspaceId: string) {
    const cur = await this.functionalCurrency(workspaceId);
    const rows = await this.db
      .select({
        accountId: accounts.id, accountName: accounts.name, accountKind: accounts.kind, brandKey: accounts.brandKey,
        assetId: assets.id, symbol: assets.symbol, name: assets.name, kind: assets.kind,
        quantity: sql<string>`sum(${ledgerEntries.quantity})`,
      })
      .from(ledgerEntries)
      .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
      .innerJoin(assets, eq(assets.id, ledgerEntries.assetId))
      .where(and(eq(ledgerEntries.workspaceId, workspaceId), eq(accounts.isSystem, false), isNull(accounts.archivedAt)))
      .groupBy(accounts.id, accounts.name, accounts.kind, accounts.brandKey, assets.id, assets.symbol, assets.name, assets.kind)
      .having(sql`sum(${ledgerEntries.quantity}) <> 0`);

    const quotes = await this.market.latestQuotes();
    const now = Date.now();
    const byAsset = new Map<string, {
      assetId: string; symbol: string; name: string; kind: string; quantity: ReturnType<typeof dec>;
      accounts: Array<{ accountId: string; name: string; kind: string; brandKey: string | null; quantity: string }>;
    }>();
    for (const r of rows) {
      const entry = byAsset.get(r.assetId) ?? { assetId: r.assetId, symbol: r.symbol, name: r.name, kind: r.kind, quantity: new D(0), accounts: [] };
      entry.quantity = entry.quantity.plus(dec(r.quantity));
      entry.accounts.push({ accountId: r.accountId, name: r.accountName, kind: r.accountKind, brandKey: r.brandKey, quantity: dec(r.quantity).toFixed() });
      byAsset.set(r.assetId, entry);
    }

    let total = new D(0);
    const unpriced: string[] = [];
    const list = [...byAsset.values()].map((a) => {
      const p = priceFor(a, cur, quotes, now);
      const qty = a.quantity.toFixed();
      const value = p.value(qty);
      if (value === null) unpriced.push(a.symbol);
      else total = total.plus(dec(value));
      return {
        assetId: a.assetId, symbol: a.symbol, name: a.name, kind: a.kind, quantity: qty, price: p.price, value, stale: p.stale,
        accounts: a.accounts
          .map((x) => ({ ...x, value: p.value(x.quantity) }))
          .sort((x, y) => (y.value === null ? -1 : x.value === null ? 1 : dec(y.value).comparedTo(dec(x.value)))),
      };
    });
    list.sort((x, y) => (y.value === null ? -1 : x.value === null ? 1 : dec(y.value).comparedTo(dec(x.value))));

    return { functionalCurrency: cur, totalValue: total.toFixed(), complete: unpriced.length === 0, unpriced, assets: list };
  }

  /**
   * Statement of one account: its balances plus every movement, newest first, with the running balance
   * after each line. Optionally limited to one asset. Voided transactions are excluded entirely (both the
   * original and the reversal), which keeps the last running balance equal to the account's balance.
   * Entries of a transaction on the same account and asset are merged, so a buy and its fee are one line.
   */
  async accountLedger(workspaceId: string, accountId: string, opts: { assetId?: string; limit: number; offset: number }) {
    const cur = await this.functionalCurrency(workspaceId);
    const [account] = await this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, workspaceId), eq(accounts.isSystem, false)));
    if (!account) throw new HttpError(404, "Rekening tidak ditemukan");

    const sums = await this.db
      .select({
        assetId: assets.id, symbol: assets.symbol, name: assets.name, kind: assets.kind,
        quantity: sql<string>`sum(${ledgerEntries.quantity})`,
      })
      .from(ledgerEntries)
      .innerJoin(assets, eq(assets.id, ledgerEntries.assetId))
      .where(and(eq(ledgerEntries.workspaceId, workspaceId), eq(ledgerEntries.accountId, accountId)))
      .groupBy(assets.id, assets.symbol, assets.name, assets.kind)
      .having(sql`sum(${ledgerEntries.quantity}) <> 0`);

    const quotes = await this.market.latestQuotes();
    const now = Date.now();
    let total = new D(0);
    let complete = true;
    const balances = sums.map((s) => {
      const p = priceFor(s, cur, quotes, now);
      const qty = dec(s.quantity).toFixed();
      const value = p.value(qty);
      if (value === null) complete = false;
      else total = total.plus(dec(value));
      return { assetId: s.assetId, symbol: s.symbol, name: s.name, kind: s.kind, quantity: qty, price: p.price, value };
    });
    balances.sort((x, y) => (y.value === null ? -1 : x.value === null ? 1 : dec(y.value).comparedTo(dec(x.value))));

    let asset = null as null | { id: string; symbol: string; name: string; kind: string; decimals: number };
    if (opts.assetId) {
      const [a] = await this.db.select().from(assets).where(eq(assets.id, opts.assetId));
      if (!a) throw new HttpError(404, "Aset tidak ditemukan");
      asset = { id: a.id, symbol: a.symbol, name: a.name, kind: a.kind, decimals: a.decimals };
    }

    const assetFilter = opts.assetId ? sql`and e.asset_id = ${opts.assetId}` : sql``;
    const res = await this.db.execute(sql`
      select * from (
        select g.*, (sum(g.q) over (partition by g.asset_id order by g.occurred_at, g.c, g.transaction_id))::text as bal
        from (
          select t.id as transaction_id, t.type::text as type, t.occurred_at, t.description, t.category, (t.debt_id is not null) as is_debt,
                 e.asset_id, a.symbol, sum(e.quantity)::text as quantity_text, sum(e.quantity) as q,
                 sum(e.functional_amount)::text as functional_text, min(e.created_at) as c
          from ledger_entries e
          join journals j on j.id = e.journal_id
          join transactions t on t.id = j.transaction_id
          join assets a on a.id = e.asset_id
          where e.workspace_id = ${workspaceId} and e.account_id = ${accountId}
            and ${LIVE_J} and t.status = 'posted' ${assetFilter}
          group by t.id, t.type, t.occurred_at, t.description, t.category, t.debt_id, e.asset_id, a.symbol
        ) g
      ) x
      order by occurred_at desc, c desc, transaction_id desc
      limit ${opts.limit + 1} offset ${opts.offset}`);

    type Raw = {
      transaction_id: string; type: string; occurred_at: Date | string; description: string | null; category: string | null;
      asset_id: string; symbol: string; quantity_text: string; functional_text: string; bal: string; is_debt: boolean;
    };
    const raw = res.rows as Raw[];
    const rows = raw.slice(0, opts.limit).map((r) => ({
      transactionId: r.transaction_id,
      type: r.type,
      occurredAt: new Date(r.occurred_at).toISOString(),
      description: r.description,
      category: r.category,
      assetId: r.asset_id,
      symbol: r.symbol,
      quantity: dec(r.quantity_text).toFixed(),
      functionalAmount: dec(r.functional_text).toFixed(),
      balance: dec(r.bal).toFixed(),
      /** Debt transactions are changed from the debt itself; the other kinds can be edited in place. */
      editable: !r.is_debt && EDITABLE_TYPES.has(r.type),
    }));

    return {
      account: { id: account.id, name: account.name, kind: account.kind, brandKey: account.brandKey, includeInNetWorth: account.includeInNetWorth },
      asset,
      balances,
      totalValue: total.toFixed(),
      complete,
      rows,
      hasMore: raw.length > opts.limit,
    };
  }
}
