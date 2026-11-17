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

interface AssetFee { quantity: string; value: string; expenseAccountId: string }

/**
 * Buy paid with another held asset (e.g. BTC bought with USDT inside one exchange account), one balanced journal:
 * the bought asset enters at `value` (its cost basis), the paying asset leaves at ITS average cost (`disposedCost`, for
 * the paid quantity plus the fee), the fee is an expense valued at `fee.value`, and the difference between what the
 * paying asset was worth and what it cost is the realised profit/loss of disposing of it.
 */
export function buildBuyWithAsset(args: {
  assetAccountId: string;
  assetId: string;
  quantity: string;
  /** Functional value of what is bought; becomes its cost basis. Excludes the fee. */
  value: string;
  payAccountId: string;
  payAssetId: string;
  /** Quantity paid, excluding the fee (the fee is taken from the same asset on top of it). */
  payQuantity: string;
  /** Average cost of everything that left (paid quantity + fee quantity). */
  disposedCost: string;
  fee?: AssetFee;
  pnlAccountId: string;
  functionalAssetId: string;
}): Entry[] {
  if (!dec(args.quantity).isPositive()) throw new Error("Buy quantity must be positive");
  if (!dec(args.value).isPositive()) throw new Error("Buy value must be positive");
  if (!dec(args.payQuantity).isPositive()) throw new Error("Paid quantity must be positive");
  if (args.assetId === args.payAssetId) throw new Error("Cannot pay for an asset with itself");
  const fee = args.fee && !dec(args.fee.quantity).isZero() ? args.fee : undefined;
  const totalOut = dec(args.payQuantity).plus(fee ? dec(fee.quantity) : 0);
  const feeValue = fee ? dec(fee.value) : dec("0");
  const entries: Entry[] = [
    { accountId: args.assetAccountId, assetId: args.assetId, quantity: dec(args.quantity).toFixed(), functionalAmount: dec(args.value).toFixed() },
    { accountId: args.payAccountId, assetId: args.payAssetId, quantity: totalOut.neg().toFixed(), functionalAmount: dec(args.disposedCost).neg().toFixed() },
  ];
  if (fee) entries.push({ accountId: fee.expenseAccountId, assetId: args.payAssetId, quantity: dec(fee.quantity).toFixed(), functionalAmount: feeValue.toFixed() });
  // worth (value + fee) minus cost: gain => credit (negative), loss => debit (positive)
  const pnl = dec(args.value).plus(feeValue).minus(dec(args.disposedCost));
  if (!pnl.isZero()) entries.push({ accountId: args.pnlAccountId, assetId: args.functionalAssetId, quantity: pnl.neg().toFixed(), functionalAmount: pnl.neg().toFixed() });
  assertBalanced(entries);
  return entries;
}

/**
 * Sell for another asset (e.g. BTC sold for USDT in the same exchange account), one balanced journal: the sold asset
 * leaves at its average cost, the received asset enters at its value (gross, less the fee taken from it), the fee is an
 * expense, and proceeds minus cost is the realised profit/loss.
 */
export function buildSellForAsset(args: {
  assetAccountId: string;
  assetId: string;
  quantity: string;
  soldCost: string;
  /** Functional value of the gross amount received (before the fee). */
  value: string;
  receiveAccountId: string;
  receiveAssetId: string;
  /** Gross quantity received; the fee quantity is deducted from it. */
  receiveQuantity: string;
  fee?: AssetFee;
  pnlAccountId: string;
  functionalAssetId: string;
}): Entry[] {
  if (!dec(args.quantity).isPositive()) throw new Error("Sell quantity must be positive");
  if (!dec(args.value).isPositive()) throw new Error("Sell value must be positive");
  if (!dec(args.receiveQuantity).isPositive()) throw new Error("Received quantity must be positive");
  if (args.assetId === args.receiveAssetId) throw new Error("Cannot sell an asset for itself");
  const fee = args.fee && !dec(args.fee.quantity).isZero() ? args.fee : undefined;
  const net = dec(args.receiveQuantity).minus(fee ? dec(fee.quantity) : 0);
  if (!net.isPositive()) throw new Error("The fee must be less than the amount received");
  const feeValue = fee ? dec(fee.value) : dec("0");
  const entries: Entry[] = [
    { accountId: args.assetAccountId, assetId: args.assetId, quantity: dec(args.quantity).neg().toFixed(), functionalAmount: dec(args.soldCost).neg().toFixed() },
    { accountId: args.receiveAccountId, assetId: args.receiveAssetId, quantity: net.toFixed(), functionalAmount: dec(args.value).minus(feeValue).toFixed() },
  ];
  if (fee) entries.push({ accountId: fee.expenseAccountId, assetId: args.receiveAssetId, quantity: dec(fee.quantity).toFixed(), functionalAmount: feeValue.toFixed() });
  const pnl = dec(args.value).minus(dec(args.soldCost));
  if (!pnl.isZero()) entries.push({ accountId: args.pnlAccountId, assetId: args.functionalAssetId, quantity: pnl.neg().toFixed(), functionalAmount: pnl.neg().toFixed() });
  assertBalanced(entries);
  return entries;
}
