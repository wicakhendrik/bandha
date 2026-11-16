import { dec, D } from "./decimal";

/**
 * One line of a journal. Quantity and functionalAmount are SIGNED:
 * positive = debit (increases the account), negative = credit (decreases it).
 * Ledger entries are immutable once posted.
 */
export interface Entry {
  accountId: string;
  assetId: string;
  quantity: string;
  /** Value in the workspace functional currency (e.g. IDR). */
  functionalAmount: string;
}

export class UnbalancedJournalError extends Error {
  constructor(public readonly difference: string) {
    super(`Journal does not balance in functional currency (difference ${difference})`);
  }
}

export function sumFunctional(entries: readonly Entry[]): string {
  return entries.reduce((acc, e) => acc.plus(dec(e.functionalAmount)), new D(0)).toFixed();
}

export function assertBalanced(entries: readonly Entry[]): void {
  if (entries.length < 2) throw new Error("A journal needs at least two entries");
  for (const e of entries) {
    if (dec(e.quantity).isZero()) {
      throw new Error("Zero-quantity ledger entries are not allowed");
    }
  }
  const diff = sumFunctional(entries);
  if (!dec(diff).isZero()) throw new UnbalancedJournalError(diff);
}

/** Reversal journal used for "void": identical entries with opposite sign. */
export function reverseEntries(entries: readonly Entry[]): Entry[] {
  return entries.map((e) => ({
    ...e,
    quantity: dec(e.quantity).neg().toFixed(),
    functionalAmount: dec(e.functionalAmount).neg().toFixed(),
  }));
}

/** Account balance is always derived from entries, never stored as truth. */
export function balanceOf(entries: readonly Entry[], accountId: string, assetId: string): string {
  return entries
    .filter((e) => e.accountId === accountId && e.assetId === assetId)
    .reduce((acc, e) => acc.plus(dec(e.quantity)), new D(0))
    .toFixed();
}
