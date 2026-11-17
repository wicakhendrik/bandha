import { qty, rp } from "./format";
import { debtTxTitle, txTypeLabel } from "./i18n";
import type { Account, Asset, LedgerRow, Tx } from "./types";

export const TYPE_LABEL: Record<string, string> = {
  income: "Pemasukan", expense: "Pengeluaran", transfer: "Transfer", opening: "Saldo awal",
  buy: "Beli", sell: "Jual", adjustment: "Penyesuaian",
  borrow: "Pinjam", lend: "Beri pinjaman", repay: "Bayar utang", collect: "Terima piutang",
};

export interface TxView {
  title: string;
  accountLabel: string;
  amount: string;
  /** Rupiah value when the amount itself is in another asset. */
  secondary: string | null;
  tone: "pos" | "neg" | "";
}

/** Presentation only: turns an API transaction into display strings. */
export function txView(t: Tx, accounts: Map<string, Account>, assets: Map<string, Asset>): TxView {
  const name = (id: string) => accounts.get(id)?.name ?? "Rekening";
  const title = t.debt ? debtTxTitle(t.type, t.debt.counterparty) : t.description || t.category || txTypeLabel(t.type);

  const fmt = (leg: Tx["legs"][number]) => {
    const a = assets.get(leg.assetId);
    const q = leg.quantity.replace(/^-/, "");
    const fn = leg.functionalAmount.replace(/^-/, "");
    return a && a.symbol !== "IDR" ? { main: `${qty(q)} ${a.symbol}`, secondary: rp(fn) } : { main: rp(q), secondary: null };
  };

  if (t.type === "transfer") {
    const out = t.legs.find((l) => l.quantity.startsWith("-"));
    const inn = t.legs.find((l) => !l.quantity.startsWith("-"));
    const f = out ? fmt(out) : { main: "—", secondary: null };
    return { title, accountLabel: `${out ? name(out.accountId) : "?"} → ${inn ? name(inn.accountId) : "?"}`, amount: f.main, secondary: f.secondary, tone: "" };
  }

  if (t.type === "buy" || t.type === "sell") {
    const buying = t.type === "buy";
    const nonIdr = t.legs.filter((l) => assets.get(l.assetId)?.symbol !== "IDR");
    const cash = t.legs.filter((l) => assets.get(l.assetId)?.symbol === "IDR");
    // The traded asset comes in on a buy and goes out on a sell; a second non-rupiah leg is what it was paid or received in.
    const held = nonIdr.find((l) => l.quantity.startsWith("-") !== buying) ?? nonIdr[0];
    const other = held ? nonIdr.find((l) => l !== held) : undefined;
    if (held) {
      const sym = assets.get(held.assetId)?.symbol ?? "";
      const otherSym = other ? (assets.get(other.assetId)?.symbol ?? "") : "";
      // A buy shows what it cost; a sell shows what it brought in (the asset leg is booked at cost, not at proceeds).
      const idrValue = buying
        ? held.functionalAmount.replace(/^-/, "")
        : other
          ? other.functionalAmount.replace(/^-/, "")
          : cash.filter((l) => !l.quantity.startsWith("-")).reduce((s, l) => s + Number(l.quantity), 0).toString();
      // Money flows from the paying account into the asset's account on a buy, and from the asset's account to the receiving one on a sell.
      const from = (other ?? cash.find((l) => l.quantity.startsWith("-")))?.accountId;
      const label = buying
        ? from && from !== held.accountId ? `${name(from)} → ${name(held.accountId)}` : name(held.accountId)
        : other && other.accountId !== held.accountId ? `${name(held.accountId)} → ${name(other.accountId)}` : name(held.accountId);
      return {
        title: t.description || `${txTypeLabel(buying ? "buy" : "sell")} ${sym}`,
        accountLabel: label,
        amount: `${buying ? "+" : "−"}${qty(held.quantity.replace(/^-/, ""))} ${sym}`,
        // Asset-for-asset: also show what changed hands on the other side, e.g. "Rp 8.100.000 · −501 USDT".
        secondary: other ? `${rp(idrValue)} · ${buying ? "−" : "+"}${qty(other.quantity.replace(/^-/, ""))} ${otherSym}` : rp(idrValue),
        tone: buying ? "pos" : "neg",
      };
    }
  }

  const leg = t.legs[0];
  if (!leg) return { title, accountLabel: "", amount: "—", secondary: null, tone: "" };
  const negative = leg.quantity.startsWith("-");
  const f = fmt(leg);
  return { title, accountLabel: name(leg.accountId), amount: `${negative ? "−" : "+"}${f.main}`, secondary: f.secondary, tone: negative ? "neg" : "pos" };
}

export function balanceText(a: Account): string {
  if (a.balances.length === 0) return rp("0");
  return a.balances.map((b) => (b.symbol === "IDR" ? rp(b.quantity) : `${qty(b.quantity)} ${b.symbol}`)).join(" · ");
}

export interface LedgerRowView {
  title: string;
  typeLabel: string;
  amount: string;
  /** Rupiah value when the movement is in another asset. */
  secondary: string | null;
  balance: string;
  tone: "pos" | "neg";
}

/** Presentation of one account-statement line (an asset movement plus the balance after it). */
export function ledgerRowView(r: LedgerRow): LedgerRowView {
  const negative = r.quantity.startsWith("-");
  const abs = r.quantity.replace(/^-/, "");
  const inRupiah = r.symbol === "IDR";
  return {
    title: r.description || r.category || txTypeLabel(r.type),
    typeLabel: txTypeLabel(r.type),
    amount: `${negative ? "−" : "+"}${inRupiah ? rp(abs) : `${qty(abs)} ${r.symbol}`}`,
    secondary: inRupiah ? null : rp(r.functionalAmount.replace(/^-/, "")),
    balance: inRupiah ? rp(r.balance) : `${qty(r.balance)} ${r.symbol}`,
    tone: negative ? "neg" : "pos",
  };
}
