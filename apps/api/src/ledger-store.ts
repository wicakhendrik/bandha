import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { accounts, assets, journals, ledgerEntries, workspaces } from "@bandha/db";
import { assertBalanced, type Entry } from "@bandha/ledger";
import { HttpError } from "./errors";
import type { Tx } from "./types";

export type SystemKind = "income" | "expense" | "equity" | "pnl" | "liability" | "receivable";
const SYSTEM_NAMES: Record<SystemKind, string> = {
  income: "Pemasukan", expense: "Pengeluaran", equity: "Modal awal", pnl: "Laba/rugi terealisasi", liability: "Utang", receivable: "Piutang",
};

/** Every referenced account must belong to this workspace, be a user account, and be active. */
export async function assertUsableAccounts(tx: Tx, workspaceId: string, ids: string[]) {
  const rows = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(inArray(accounts.id, ids), eq(accounts.workspaceId, workspaceId), eq(accounts.isSystem, false), isNull(accounts.archivedAt)));
  if (rows.length !== new Set(ids).size) throw new HttpError(404, "Rekening tidak ditemukan atau sudah diarsipkan");
}

/** Hidden counter-accounts that make every journal balance. Created lazily, once per kind. */
export async function systemAccountId(tx: Tx, workspaceId: string, kind: SystemKind): Promise<string> {
  const find = async () => {
    const [row] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.workspaceId, workspaceId), eq(accounts.kind, kind), eq(accounts.isSystem, true)));
    return row?.id;
  };
  const existing = await find();
  if (existing) return existing;
  await tx
    .insert(accounts)
    .values({ workspaceId, name: SYSTEM_NAMES[kind], kind, isSystem: true, includeInNetWorth: false })
    .onConflictDoNothing();
  const created = await find();
  if (!created) throw new Error("System account could not be created");
  return created;
}

/** The only place ledger rows are written. Entries are validated as balanced first. */
export async function postJournal(
  tx: Tx,
  args: { workspaceId: string; transactionId: string; postedAt: Date; entries: Entry[]; reversesJournalId?: string },
): Promise<string> {
  assertBalanced(args.entries);
  const [j] = await tx
    .insert(journals)
    .values({
      workspaceId: args.workspaceId,
      transactionId: args.transactionId,
      postedAt: args.postedAt,
      reversesJournalId: args.reversesJournalId ?? null,
    })
    .returning({ id: journals.id });
  if (!j) throw new Error("Journal insert failed");
  await tx.insert(ledgerEntries).values(
    args.entries.map((e) => ({
      journalId: j.id,
      workspaceId: args.workspaceId,
      accountId: e.accountId,
      assetId: e.assetId,
      quantity: e.quantity,
      functionalAmount: e.functionalAmount,
    })),
  );
  return j.id;
}

/** The asset that represents the workspace functional currency (IDR), used for the cash side of trades. */
export async function functionalAsset(tx: Tx, workspaceId: string): Promise<{ id: string; symbol: string }> {
  const [row] = await tx
    .select({ id: assets.id, symbol: assets.symbol })
    .from(workspaces)
    .innerJoin(assets, and(eq(assets.symbol, workspaces.functionalCurrency), eq(assets.kind, "fiat")))
    .where(eq(workspaces.id, workspaceId));
  if (!row) throw new Error("Functional currency asset is missing");
  return row;
}

/**
 * A journal that is still in force: not a reversal, and not itself reversed (by a void or by an edit that replaced it).
 * Editing a posted transaction posts a reversal of its live journal plus a replacement, so "original journals only"
 * is no longer enough: statements must read the live journal. `LIVE_J` is for raw SQL where the journal alias is `j`.
 */
export const LIVE_J = sql.raw("j.reverses_journal_id is null and not exists (select 1 from journals rv where rv.reverses_journal_id = j.id)");
/** Same condition for the query builder, where `journals` is not aliased. */
export const liveJournal = sql`${journals.reversesJournalId} is null and not exists (select 1 from journals rv where rv.reverses_journal_id = ${journals.id})`;

/** The journal currently in force for a transaction (its original, or the replacement after an edit). */
export async function liveJournalOf(tx: Tx, transactionId: string): Promise<{ id: string; createdAt: Date }> {
  const [j] = await tx.select({ id: journals.id, createdAt: journals.createdAt }).from(journals).where(and(eq(journals.transactionId, transactionId), liveJournal));
  if (!j) throw new Error("Live journal missing");
  return j;
}
