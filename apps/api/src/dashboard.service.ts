import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";
import { accounts, assets, ledgerEntries, netWorthSnapshots, workspaces, type Db } from "@bandha/db";
import { allocate, dec, valueHoldings, type HoldingInput } from "@bandha/ledger";
import { debtTotals } from "./debt-ledger";
import { LIVE_J } from "./ledger-store";
import { HttpError } from "./errors";
import type { MarketDataService } from "./market/market.service";

const TZ = "Asia/Jakarta";
const STALE_AFTER_MS = 6 * 3_600_000;

/** "YYYY-MM-DD" for an instant, in the app timezone. */
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);

export class DashboardService {
  constructor(private readonly db: Db, private readonly market: MarketDataService) {}

  /**
   * Net worth = every active, net-worth-included user account valued in the workspace functional
   * currency. Holdings without a usable price are listed as unpriced and make `complete` false;
   * they are never valued at zero.
   */
  async summary(workspaceId: string) {
    const [ws] = await this.db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    if (!ws) throw new HttpError(404, "Workspace tidak ditemukan");
    const cur = ws.functionalCurrency;

    const sums = await this.db
      .select({
        assetId: assets.id,
        symbol: assets.symbol,
        name: assets.name,
        kind: assets.kind,
        quantity: sql<string>`sum(${ledgerEntries.quantity})`,
        accountCount: sql<number>`count(distinct ${ledgerEntries.accountId})::int`,
      })
      .from(ledgerEntries)
      .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
      .innerJoin(assets, eq(assets.id, ledgerEntries.assetId))
      .where(
        and(
          eq(ledgerEntries.workspaceId, workspaceId),
          eq(accounts.isSystem, false),
          eq(accounts.includeInNetWorth, true),
          isNull(accounts.archivedAt),
        ),
      )
      .groupBy(assets.id, assets.symbol, assets.name, assets.kind);

    const held = sums.filter((s) => !dec(s.quantity).isZero());
    const holdings = held.map<HoldingInput>((s) => ({
      assetId: s.assetId,
      symbol: s.symbol,
      kind: s.kind,
      quantity: dec(s.quantity).toFixed(),
      isFunctional: s.kind === "fiat" && s.symbol === cur,
    }));

    const valuation = valueHoldings(holdings, await this.market.latestQuotes(), cur, new Date(), STALE_AFTER_MS);
    const meta = new Map(held.map((s) => [s.assetId, s]));

    // Money I owe lowers net worth, money owed to me raises it. Borrowing or lending against an account therefore
    // leaves net worth unchanged (cash and the debt cancel out) until it is repaid with interest or written off.
    const debt = await debtTotals(this.db, workspaceId);
    const netWorth = dec(valuation.total).plus(dec(debt.receivable)).minus(dec(debt.payable)).toFixed();

    return {
      functionalCurrency: cur,
      netWorth,
      debts: debt,
      complete: valuation.complete,
      unpriced: valuation.unpriced,
      allocation: allocate(valuation.rows.flatMap((r) => (r.value === null ? [] : [{ key: r.kind, value: r.value }]))),
      holdings: valuation.rows
        .map((r) => ({
          assetId: r.assetId,
          symbol: r.symbol,
          name: meta.get(r.assetId)?.name ?? r.symbol,
          kind: r.kind,
          quantity: r.quantity,
          price: r.price,
          value: r.value,
          stale: r.stale,
          priceAsOf: r.priceAsOf,
          accountCount: meta.get(r.assetId)?.accountCount ?? 0,
        }))
        .sort((a, b) => (b.value === null ? -1 : a.value === null ? 1 : dec(b.value).comparedTo(dec(a.value)))),
    };
  }

  /**
   * Income/expense per month from posted transactions only. Attribution uses the transaction's
   * own date, so voiding an old transaction removes it from its original month.
   */
  async cashflow(workspaceId: string, months = 6) {
    const n = Math.min(Math.max(months, 1), 24);
    const [y0, m0] = dayKey(new Date()).split("-").map(Number) as [number, number];
    const keys: string[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const idx = y0 * 12 + (m0 - 1) - i;
      keys.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`);
    }
    const since = new Date(`${keys[0]}-01T00:00:00+07:00`);

    const res = await this.db.execute(sql`
      select to_char(date_trunc('month', t.occurred_at at time zone ${TZ}), 'YYYY-MM') as month,
             a.kind::text as kind,
             sum(e.functional_amount)::text as total
      from ledger_entries e
      join accounts a on a.id = e.account_id
      join journals j on j.id = e.journal_id
      join transactions t on t.id = j.transaction_id
      where e.workspace_id = ${workspaceId}
        and a.is_system and a.kind in ('income', 'expense')
        and ${LIVE_J}
        and t.status = 'posted'
        and t.occurred_at >= ${since}
      group by 1, 2`);
    const rows = res.rows as Array<{ month: string; kind: string; total: string }>;

    return keys.map((month) => {
      const pick = (kind: string) => rows.find((r) => r.month === month && r.kind === kind)?.total ?? "0";
      const income = dec(pick("income")).neg(); // income is credited, so stored negative
      const expense = dec(pick("expense"));
      return { month, income: income.toFixed(), expense: expense.toFixed(), net: income.minus(expense).toFixed() };
    });
  }

  /**
   * Detail behind one month's income or expense: totals per category (for the pie chart) and the
   * transactions themselves. Same rules as `cashflow`: posted transactions only, dated by their own date,
   * original journals only, so a voided transaction disappears from its month.
   */
  async cashflowDetail(workspaceId: string, kind: "income" | "expense", month: string) {
    const [yy, mm] = month.split("-").map(Number) as [number, number];
    const from = new Date(`${month}-01T00:00:00+07:00`);
    const next = yy * 12 + mm; // 0-based month index of the following month
    const to = new Date(`${Math.floor(next / 12)}-${String((next % 12) + 1).padStart(2, "0")}-01T00:00:00+07:00`);
    // `kind` is validated to one of two literals by the caller, so inlining it is safe.
    const kindSql = sql.raw(`'${kind}'`);
    const sign = kind === "income" ? -1 : 1; // income is credited (negative), expense debited (positive)

    const cats = await this.db.execute(sql`
      select coalesce(nullif(t.category, ''), '') as category, sum(e.functional_amount)::text as total
      from ledger_entries e
      join accounts a on a.id = e.account_id and a.is_system and a.kind = ${kindSql}::account_kind
      join journals j on j.id = e.journal_id and ${LIVE_J}
      join transactions t on t.id = j.transaction_id and t.status = 'posted'
      where e.workspace_id = ${workspaceId} and t.occurred_at >= ${from} and t.occurred_at < ${to}
      group by 1`);
    const categories = (cats.rows as Array<{ category: string; total: string }>)
      .map((r) => ({ category: r.category || null, total: dec(r.total).times(sign) }))
      .filter((r) => !r.total.isZero())
      .sort((a, b) => b.total.comparedTo(a.total));
    const total = categories.reduce((acc, r) => acc.plus(r.total), dec("0"));

    const txs = await this.db.execute(sql`
      select t.id as transaction_id, t.type::text as type, t.occurred_at, t.description, t.category,
             s.symbol, e.quantity::text as quantity, e.functional_amount::text as functional_amount,
             acc.id as account_id, acc.name as account_name, acc.kind::text as account_kind, acc.brand_key
      from ledger_entries e
      join accounts a on a.id = e.account_id and a.is_system and a.kind = ${kindSql}::account_kind
      join journals j on j.id = e.journal_id and ${LIVE_J}
      join transactions t on t.id = j.transaction_id and t.status = 'posted'
      join assets s on s.id = e.asset_id
      left join lateral (
        select oa.id, oa.name, oa.kind, oa.brand_key
        from ledger_entries o join accounts oa on oa.id = o.account_id and not oa.is_system
        where o.journal_id = e.journal_id and o.asset_id = e.asset_id and o.functional_amount = -e.functional_amount
        limit 1
      ) acc on true
      where e.workspace_id = ${workspaceId} and t.occurred_at >= ${from} and t.occurred_at < ${to}
      order by t.occurred_at desc, t.created_at desc
      limit 300`);

    return {
      month,
      kind,
      total: total.toFixed(),
      categories: categories.map((c) => ({
        category: c.category,
        total: c.total.toFixed(),
        percent: total.isZero() ? "0.0" : c.total.div(total).times(100).toFixed(1),
      })),
      transactions: (txs.rows as Array<Record<string, string | Date | null>>).map((r) => ({
        id: r.transaction_id as string,
        type: r.type as string,
        occurredAt: new Date(r.occurred_at as string).toISOString(),
        description: r.description as string | null,
        category: (r.category as string | null) || null,
        symbol: r.symbol as string,
        amount: dec(r.functional_amount as string).times(sign).toFixed(),
        account: r.account_id
          ? { id: r.account_id as string, name: r.account_name as string, kind: r.account_kind as string, brandKey: r.brand_key as string | null }
          : null,
      })),
    };
  }

  async history(workspaceId: string, days = 180) {
    const from = dayKey(new Date(Date.now() - Math.min(Math.max(days, 1), 3650) * 86_400_000));
    const rows = await this.db
      .select({ day: netWorthSnapshots.day, netWorth: netWorthSnapshots.netWorth, complete: netWorthSnapshots.complete })
      .from(netWorthSnapshots)
      .where(and(eq(netWorthSnapshots.workspaceId, workspaceId), gte(netWorthSnapshots.day, from)))
      .orderBy(asc(netWorthSnapshots.day));
    return rows.map((r) => ({ day: r.day, netWorth: dec(r.netWorth).toFixed(), complete: r.complete }));
  }

  async recordSnapshot(workspaceId: string) {
    const s = await this.summary(workspaceId);
    await this.db
      .insert(netWorthSnapshots)
      .values({ workspaceId, day: dayKey(new Date()), netWorth: s.netWorth, complete: s.complete })
      .onConflictDoUpdate({
        target: [netWorthSnapshots.workspaceId, netWorthSnapshots.day],
        set: { netWorth: s.netWorth, complete: s.complete, updatedAt: new Date() },
      });
    return s;
  }

  /** Run after each price sync so every workspace's chart gets a point for today. */
  async snapshotAll(): Promise<number> {
    const all = await this.db.select({ id: workspaces.id }).from(workspaces);
    let ok = 0;
    for (const w of all) {
      try { await this.recordSnapshot(w.id); ok++; } catch { /* one workspace must not block the rest */ }
    }
    return ok;
  }
}
