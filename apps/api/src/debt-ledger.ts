import { and, eq, sql } from "drizzle-orm";
import { debts, type Db } from "@bandha/db";
import { dec, type Entry } from "@bandha/ledger";
import { HttpError } from "./errors";
import { systemAccountId } from "./ledger-store";
import type { Tx } from "./types";

type Runner = Db | Tx;

/**
 * Outstanding amount per debt, derived from the ledger (never stored):
 * payable  = -(sum of entries on the hidden "Utang" account) because the liability is credited,
 * receivable = sum of entries on the hidden "Piutang" account because the asset is debited.
 * Opening, repayments and their reversals all net out here, so a voided payment simply disappears.
 */
export async function outstandingByDebt(q: Runner, workspaceId: string, debtIds?: string[]): Promise<Map<string, string>> {
  if (debtIds && debtIds.length === 0) return new Map();
  const only = debtIds ? sql`and t.debt_id in (${sql.join(debtIds.map((i) => sql`${i}::uuid`), sql`, `)})` : sql``;
  const res = await q.execute(sql`
    select t.debt_id::text as id, a.kind::text as kind, sum(e.functional_amount)::text as total
    from ledger_entries e
    join accounts a on a.id = e.account_id and a.is_system and a.kind in ('liability', 'receivable')
    join journals j on j.id = e.journal_id
    join transactions t on t.id = j.transaction_id
    where e.workspace_id = ${workspaceId} and t.debt_id is not null ${only}
    group by 1, 2`);
  const out = new Map<string, string>();
  for (const r of res.rows as Array<{ id: string; kind: string; total: string }>) {
    out.set(r.id, (r.kind === "liability" ? dec(r.total).neg() : dec(r.total)).toFixed());
  }
  return out;
}

/** What I owe and what is owed to me right now, in the functional currency. Used by the dashboard and net worth. */
export async function debtTotals(q: Runner, workspaceId: string): Promise<{ payable: string; receivable: string }> {
  const res = await q.execute(sql`
    select a.kind::text as kind, coalesce(sum(e.functional_amount), 0)::text as total
    from ledger_entries e
    join accounts a on a.id = e.account_id and a.is_system and a.kind in ('liability', 'receivable')
    where e.workspace_id = ${workspaceId}
    group by 1`);
  const rows = res.rows as Array<{ kind: string; total: string }>;
  const pick = (k: string) => dec(rows.find((r) => r.kind === k)?.total ?? "0");
  return { payable: pick("liability").neg().toFixed(), receivable: pick("receivable").toFixed() };
}

/**
 * Called while voiding a transaction that belongs to a debt (inside the void's DB transaction).
 * Locks the debt so concurrent payments/voids serialise, and refuses a void that would leave a negative balance
 * (voiding the opening of a debt that already has payments). Voiding the opening marks the debt void.
 */
export async function guardDebtVoid(tx: Tx, workspaceId: string, t: { debtId: string; type: string }, reversal: readonly Entry[]): Promise<void> {
  const [d] = await tx.select().from(debts).where(and(eq(debts.id, t.debtId), eq(debts.workspaceId, workspaceId))).for("update");
  if (!d) throw new Error("Debt missing");
  const payable = d.direction === "payable";
  const ctrl = await systemAccountId(tx, workspaceId, payable ? "liability" : "receivable");
  const delta = reversal.filter((e) => e.accountId === ctrl).reduce((acc, e) => acc.plus(dec(e.functionalAmount)), dec("0"));
  const remaining = dec((await outstandingByDebt(tx, workspaceId, [d.id])).get(d.id) ?? "0");
  const after = payable ? remaining.minus(delta) : remaining.plus(delta);
  if (after.isNegative()) throw new HttpError(409, "Utang ini sudah punya pembayaran. Batalkan pembayarannya lebih dulu");
  if (t.type === "borrow" || t.type === "lend") {
    const now = new Date();
    await tx.update(debts).set({ voidedAt: now, updatedAt: now }).where(eq(debts.id, d.id));
  }
}
