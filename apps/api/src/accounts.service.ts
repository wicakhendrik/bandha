import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { accounts, assets, institutions, ledgerEntries, transactions, workspaces, type Db } from "@bandha/db";
import { buildOpeningBalance, dec } from "@bandha/ledger";
import type { CreateAccountInput, UpdateAccountInput } from "@bandha/validation";
import { HttpError } from "./errors";
import { postJournal, systemAccountId } from "./ledger-store";
import type { Tx } from "./types";

export interface Balance { assetId: string; symbol: string; quantity: string }

/** Resolve the functional-currency value of a leg. Non-functional assets must state it explicitly. */
export async function functionalAmountFor(
  tx: Tx | Db, workspaceId: string, assetId: string, quantity: string, given: string | undefined,
): Promise<string> {
  const [ws] = await tx.select({ cur: workspaces.functionalCurrency }).from(workspaces).where(eq(workspaces.id, workspaceId));
  const [asset] = await tx.select().from(assets).where(eq(assets.id, assetId));
  if (!ws || !asset) throw new HttpError(404, "Aset tidak ditemukan");
  if (asset.kind === "fiat" && asset.symbol === ws.cur) return dec(quantity).toFixed();
  if (given === undefined) throw new HttpError(400, `Nilai dalam ${ws.cur} wajib diisi untuk aset ${asset.symbol}`);
  return dec(given).toFixed();
}

export class AccountsService {
  constructor(private readonly db: Db) {}

  /** Balances are derived from immutable ledger entries, never stored as truth. */
  async list(workspaceId: string, includeArchived = false) {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.workspaceId, workspaceId), eq(accounts.isSystem, false), includeArchived ? undefined : isNull(accounts.archivedAt)))
      .orderBy(asc(accounts.createdAt));

    const sums = await this.db
      .select({
        accountId: ledgerEntries.accountId,
        assetId: ledgerEntries.assetId,
        symbol: assets.symbol,
        quantity: sql<string>`sum(${ledgerEntries.quantity})`,
      })
      .from(ledgerEntries)
      .innerJoin(assets, eq(assets.id, ledgerEntries.assetId))
      .where(eq(ledgerEntries.workspaceId, workspaceId))
      .groupBy(ledgerEntries.accountId, ledgerEntries.assetId, assets.symbol);

    return rows.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      brandKey: a.brandKey,
      institutionId: a.institutionId,
      includeInNetWorth: a.includeInNetWorth,
      archivedAt: a.archivedAt,
      balances: sums
        .filter((s) => s.accountId === a.id && !dec(s.quantity).isZero())
        .map<Balance>((s) => ({ assetId: s.assetId, symbol: s.symbol, quantity: dec(s.quantity).toFixed() })),
    }));
  }

  async create(workspaceId: string, userId: string, input: CreateAccountInput) {
    return this.db.transaction(async (tx) => {
      if (input.institutionId) {
        const [inst] = await tx
          .select({ id: institutions.id })
          .from(institutions)
          .where(and(eq(institutions.id, input.institutionId), eq(institutions.workspaceId, workspaceId)));
        if (!inst) throw new HttpError(404, "Lembaga tidak ditemukan");
      }
      const [acc] = await tx
        .insert(accounts)
        .values({
          workspaceId,
          name: input.name,
          kind: input.kind,
          brandKey: input.brandKey ?? null,
          institutionId: input.institutionId ?? null,
          includeInNetWorth: input.includeInNetWorth,
        })
        .returning();
      if (!acc) throw new Error("Account insert failed");

      const ob = input.openingBalance;
      if (ob) {
        const functionalAmount = await functionalAmountFor(tx, workspaceId, ob.assetId, ob.quantity, ob.functionalAmount);
        const entries = buildOpeningBalance({
          account: { accountId: acc.id, assetId: ob.assetId, quantity: ob.quantity, functionalAmount },
          equityAccountId: await systemAccountId(tx, workspaceId, "equity"),
          equityAssetId: ob.assetId,
        });
        // Zero opening balance builds no entries, so no transaction/journal is created either.
        if (entries.length > 0) {
          const now = new Date();
          const [t] = await tx
            .insert(transactions)
            .values({ workspaceId, type: "opening", status: "posted", occurredAt: now, description: `Saldo awal ${acc.name}`, createdByUserId: userId })
            .returning({ id: transactions.id });
          if (!t) throw new Error("Transaction insert failed");
          await postJournal(tx, { workspaceId, transactionId: t.id, postedAt: now, entries });
        }
      }
      return { id: acc.id, name: acc.name, kind: acc.kind, brandKey: acc.brandKey, includeInNetWorth: acc.includeInNetWorth };
    });
  }

  async update(workspaceId: string, id: string, patch: UpdateAccountInput) {
    const [row] = await this.db
      .update(accounts)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(accounts.id, id), eq(accounts.workspaceId, workspaceId), eq(accounts.isSystem, false)))
      .returning({ id: accounts.id, name: accounts.name, brandKey: accounts.brandKey, includeInNetWorth: accounts.includeInNetWorth });
    if (!row) throw new HttpError(404, "Rekening tidak ditemukan");
    return row;
  }

  /** Archive hides the account; its ledger history stays intact. */
  async archive(workspaceId: string, id: string) {
    const [row] = await this.db
      .update(accounts)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(accounts.id, id), eq(accounts.workspaceId, workspaceId), eq(accounts.isSystem, false), isNull(accounts.archivedAt)))
      .returning({ id: accounts.id });
    if (!row) throw new HttpError(404, "Rekening tidak ditemukan");
  }
}
