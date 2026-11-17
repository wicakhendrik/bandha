// Shared logic of the add/edit transaction form (web modal and mobile screen): ready-made categories, what an account
// can still spend, and the quick-fill percentages. Money stays a decimal string; Number() is only used to compare
// against the balance and to round the quick-fill amounts DOWN.

import { PRIORITY_COINS } from "./brands";
import type { Account, Asset, EditableTx } from "./types";

export interface QuickCategory { id: string; icon: string; en: string }

/** Ready-made categories, the same ones FinMap offers. The Indonesian name (`id`) is what gets stored; `en` is display only. */
export const EXPENSE_CATEGORIES: QuickCategory[] = [
  { id: "Makanan & Minuman", icon: "🍔", en: "Food & Drink" },
  { id: "Belanja & Kebutuhan", icon: "🛒", en: "Shopping & Essentials" },
  { id: "Transportasi", icon: "🚗", en: "Transport" },
  { id: "Tagihan & Utilitas", icon: "⚡", en: "Bills & Utilities" },
  { id: "Hiburan & Rekreasi", icon: "🍿", en: "Entertainment & Leisure" },
  { id: "Kesehatan", icon: "🏥", en: "Health" },
  { id: "Pendidikan & Kerja", icon: "💼", en: "Education & Work" },
  { id: "Biaya Admin & Fee", icon: "💸", en: "Admin & Fees" },
  { id: "Lainnya", icon: "🏷️", en: "Other" },
];
export const INCOME_CATEGORIES: QuickCategory[] = [
  { id: "Gaji Pokok", icon: "💼", en: "Salary" },
  { id: "Investasi & Profit", icon: "📈", en: "Investment & Profit" },
  { id: "Bonus & THR", icon: "🎁", en: "Bonus & Holiday pay" },
  { id: "Penjualan / Bisnis", icon: "🏪", en: "Sales / Business" },
  { id: "Cashback & Hadiah", icon: "✨", en: "Cashback & Gifts" },
  { id: "Pengembalian (Refund)", icon: "🔄", en: "Refund" },
  { id: "Lainnya", icon: "🏷️", en: "Other" },
];

/** Quick-fill shares offered under an amount field; 100 is labelled "Max". */
export const QUICK_PCT = [25, 50, 75, 100] as const;

export const trimZeros = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);

/** `pct` percent of `available`, rounded DOWN so it can never exceed what is held. 100% returns the exact balance. */
export function share(available: string, pctValue: number, decimals: number): string {
  if (pctValue >= 100) return trimZeros(available);
  const f = 10 ** decimals;
  const v = Math.floor((Number(available) * pctValue / 100) * f + 1e-9) / f;
  return trimZeros(v.toFixed(decimals));
}

/** Decimals an asset's amounts are typed with: whole rupiah, otherwise up to 8. */
export const decimalsOf = (a?: Pick<Asset, "symbol" | "decimals">): number => (!a || a.symbol === "IDR" ? 0 : Math.min(a.decimals ?? 8, 8));

/**
 * What an account holds of an asset, plus (when editing) what the edited transaction itself had taken from it: an
 * edit reverses the old journal first, so that quantity is spendable again.
 */
export function availableQty(
  accounts: Array<Pick<Account, "id" | "balances">>,
  edit: EditableTx | undefined,
  idrAssetId: string | undefined,
  accountId: string,
  assetId: string,
): string {
  const bal = accounts.find((a) => a.id === accountId)?.balances.find((b) => b.assetId === assetId)?.quantity ?? "0";
  let back = 0;
  if (edit && assetId) {
    if ((edit.type === "expense" || edit.type === "sell") && edit.accountId === accountId && edit.assetId === assetId) back = Number(edit.quantity);
    if (edit.type === "transfer" && edit.fromAccountId === accountId && edit.assetId === assetId) back = Number(edit.quantity);
    if (edit.type === "buy" && edit.fundingAccountId === accountId) {
      if (edit.payAssetId === assetId) back = Number(edit.payQuantity ?? 0) + Number(edit.fee ?? 0);
      else if (!edit.payAssetId && assetId === idrAssetId) back = Number(edit.totalCost ?? 0) + Number(edit.fee ?? 0);
    }
  }
  const sum = Number(bal) + back;
  return sum > 0 ? trimZeros(String(Number(sum.toFixed(12)))) : "0";
}

export type AssetGroup = "fiat" | "gold" | "stockId" | "stockUs" | "mainCoins" | "otherCoins";

/** Which heading an asset is listed under in the pickers. Indonesian shares are the Yahoo ".JK" tickers. */
export function assetGroup(a: Pick<Asset, "kind" | "symbol" | "providerRef">): AssetGroup {
  if (a.kind === "fiat") return "fiat";
  if (a.kind === "gold") return "gold";
  if (a.kind === "stock") return a.providerRef?.endsWith(".JK") ? "stockId" : "stockUs";
  return PRIORITY_COINS.includes(a.symbol) ? "mainCoins" : "otherCoins";
}
