import { D, dec } from "./decimal";
import { assertBalanced, type Entry } from "./journal";

/**
 * Money amounts are stored with 8 decimals (numeric(38,8)). Anything derived by division (average cost)
 * MUST be rounded before it is posted: the database rounds each row independently, so unrounded values
 * could make a journal that balanced in memory stop balancing on disk.
 */
export const roundMoney = (v: string): string => dec(v).toDecimalPlaces(8, D.ROUND_HALF_EVEN).toFixed();

interface Fee { amount: string; expenseAccountId: string }

function feeEntries(cashAccountId: string, cashAssetId: string, fee: Fee | undefined): Entry[] {
  if (!fee || dec(fee.amount).isZero()) return [];
  return [
    { accountId: cashAccountId, assetId: cashAssetId, quantity: dec(fee.amount).neg().toFixed(), functionalAmount: dec(fee.amount).neg().toFixed() },
    { accountId: fee.expenseAccountId, assetId: cashAssetId, quantity: dec(fee.amount).toFixed(), functionalAmount: dec(fee.amount).toFixed() },
  ];
}

/**
 * Buy: the asset enters at its cost (functional value) and cash leaves for the same amount.
 * A fee is a separate expense entry; it is never folded into the cost basis.
 */
export function buildBuy(args: {
  assetAccountId: string;
  assetId: string;
  quantity: string;
  cost: string;
  cashAccountId: string;
  cashAssetId: string;
  fee?: Fee;
}): Entry[] {
  if (!dec(args.quantity).isPositive()) throw new Error("Buy quantity must be positive");
  if (!dec(args.cost).isPositive()) throw new Error("Buy cost must be positive");
  const entries: Entry[] = [
    { accountId: args.assetAccountId, assetId: args.assetId, quantity: dec(args.quantity).toFixed(), functionalAmount: dec(args.cost).toFixed() },
    { accountId: args.cashAccountId, assetId: args.cashAssetId, quantity: dec(args.cost).neg().toFixed(), functionalAmount: dec(args.cost).neg().toFixed() },
    ...feeEntries(args.cashAccountId, args.cashAssetId, args.fee),
  ];
  assertBalanced(entries);
  return entries;
}

/**
 * Sell: the asset leaves at its average COST (soldCost), cash arrives at the proceeds, and the difference
 * is posted to the realised profit/loss account (credit = gain, debit = loss). Zero P/L posts no entry.
 */
export function buildSell(args: {
  assetAccountId: string;
  assetId: string;
  quantity: string;
  soldCost: string;
  proceeds: string;
  cashAccountId: string;
  cashAssetId: string;
  pnlAccountId: string;
  fee?: Fee;
}): Entry[] {
  if (!dec(args.quantity).isPositive()) throw new Error("Sell quantity must be positive");
  if (dec(args.proceeds).isNegative()) throw new Error("Sell proceeds cannot be negative");
  const pnl = dec(args.proceeds).minus(dec(args.soldCost));
  const entries: Entry[] = [
    { accountId: args.assetAccountId, assetId: args.assetId, quantity: dec(args.quantity).neg().toFixed(), functionalAmount: dec(args.soldCost).neg().toFixed() },
  ];
  if (!dec(args.proceeds).isZero()) {
    entries.push({ accountId: args.cashAccountId, assetId: args.cashAssetId, quantity: dec(args.proceeds).toFixed(), functionalAmount: dec(args.proceeds).toFixed() });
  }
  if (!pnl.isZero()) {
    // gain => credit (negative), loss => debit (positive)
    entries.push({ accountId: args.pnlAccountId, assetId: args.cashAssetId, quantity: pnl.neg().toFixed(), functionalAmount: pnl.neg().toFixed() });
  }
  entries.push(...feeEntries(args.cashAccountId, args.cashAssetId, args.fee));
  assertBalanced(entries);
  return entries;
}
