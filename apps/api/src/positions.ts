import { and, eq, inArray, sql } from "drizzle-orm";
import { accounts, ledgerEntries } from "@bandha/db";
import { dec, type Position } from "@bandha/ledger";
import type { Tx } from "./types";

/**
 * A position is DERIVED from the immutable ledger, never stored as truth:
 * quantity = sum of quantities, cost basis = sum of functional values booked for that (account, asset).
 * Buys book the asset at cost, sells and transfers remove it at proportional average cost, so the sum
 * of functional amounts is exactly the weighted-average cost basis of what is still held.
 */
export async function positionOf(tx: Tx, workspaceId: string, accountId: string, assetId: string): Promise<Position> {
  const [row] = await tx
    .select({ q: sql<string>`coalesce(sum(${ledgerEntries.quantity}), 0)`, c: sql<string>`coalesce(sum(${ledgerEntries.functionalAmount}), 0)` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.workspaceId, workspaceId), eq(ledgerEntries.accountId, accountId), eq(ledgerEntries.assetId, assetId)));
  return { quantity: dec(row?.q ?? "0").toFixed(), costBasis: dec(row?.c ?? "0").toFixed() };
}

/**
 * Serialises concurrent writes to the same accounts (two simultaneous sells must not both pass the
 * "enough held" check). Ordered by id so two transactions locking the same pair cannot deadlock.
 */
export async function lockAccounts(tx: Tx, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  await tx.select({ id: accounts.id }).from(accounts).where(inArray(accounts.id, unique)).orderBy(accounts.id).for("update");
}
