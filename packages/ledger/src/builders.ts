import { dec } from "./decimal";
import { assertBalanced, type Entry } from "./journal";

/**
 * Journals are built against a counter-account (income / expense / equity) so every
 * posted journal balances. Counter-account ids are supplied by the caller.
 */
export interface MoneyLeg {
  accountId: string;
  assetId: string;
  quantity: string;
  functionalAmount: string;
}

/** Income: money enters an account; counter-entry on the income account. */
export function buildIncome(args: { cash: MoneyLeg; incomeAccountId: string; incomeAssetId: string }): Entry[] {
  const entries: Entry[] = [
    { ...args.cash },
    {
      accountId: args.incomeAccountId,
      assetId: args.incomeAssetId,
      quantity: dec(args.cash.quantity).neg().toFixed(),
      functionalAmount: dec(args.cash.functionalAmount).neg().toFixed(),
    },
  ];
  assertBalanced(entries);
  return entries;
}

/** Expense: money leaves an account; counter-entry on the expense account. */
export function buildExpense(args: { cash: MoneyLeg; expenseAccountId: string; expenseAssetId: string }): Entry[] {
  const q = dec(args.cash.quantity);
  const f = dec(args.cash.functionalAmount);
  if (q.isNegative() || f.isNegative()) throw new Error("Pass expense amounts as positive values");
  const entries: Entry[] = [
    { ...args.cash, quantity: q.neg().toFixed(), functionalAmount: f.neg().toFixed() },
    { accountId: args.expenseAccountId, assetId: args.expenseAssetId, quantity: q.toFixed(), functionalAmount: f.toFixed() },
  ];
  assertBalanced(entries);
  return entries;
}

/**
 * Transfer between two accounts of the SAME asset. It is neither income nor expense.
 * A fee is NOT folded in here: callers post it as a separate expense journal.
 */
export function buildTransfer(args: {
  fromAccountId: string;
  toAccountId: string;
  assetId: string;
  quantity: string;
  functionalAmount: string;
}): Entry[] {
  const q = dec(args.quantity);
  const f = dec(args.functionalAmount);
  if (!q.isPositive()) throw new Error("Transfer quantity must be positive");
  if (args.fromAccountId === args.toAccountId) throw new Error("Cannot transfer to the same account");
  const entries: Entry[] = [
    { accountId: args.fromAccountId, assetId: args.assetId, quantity: q.neg().toFixed(), functionalAmount: f.neg().toFixed() },
    { accountId: args.toAccountId, assetId: args.assetId, quantity: q.toFixed(), functionalAmount: f.toFixed() },
  ];
  assertBalanced(entries);
  return entries;
}

/** Opening balance. A zero opening balance creates NO entries (no zero-value rows). */
export function buildOpeningBalance(args: {
  account: MoneyLeg;
  equityAccountId: string;
  equityAssetId: string;
}): Entry[] {
  if (dec(args.account.quantity).isZero()) return [];
  return buildIncome({ cash: args.account, incomeAccountId: args.equityAccountId, incomeAssetId: args.equityAssetId });
}
