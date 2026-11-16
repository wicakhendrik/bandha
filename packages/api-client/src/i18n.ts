/**
 * Language for the shared labels and number/date formatting. The web app switches it at runtime
 * (Indonesian or English); the mobile app stays on Indonesian, the default.
 */
export type Lang = "id" | "en";

let current: Lang = "id";
export const getLang = (): Lang => current;
export const setLang = (lang: Lang): void => { current = lang; };

/** Picks the text for the current language. */
export const pick = <T>(id: T, en: T): T => (current === "en" ? en : id);

const KIND: Record<string, [string, string]> = {
  fiat: ["Kas & bank", "Cash & bank"], crypto: ["Kripto", "Crypto"], gold: ["Emas", "Gold"],
  stock: ["Saham", "Stocks"], fund: ["Reksa dana", "Funds"], other: ["Lainnya", "Other"],
};
const ACCOUNT_KIND: Record<string, [string, string]> = {
  cash: ["Tunai", "Cash"], bank: ["Bank", "Bank"], ewallet: ["Dompet digital", "E-wallet"], exchange: ["Bursa kripto", "Crypto exchange"],
  wallet: ["Dompet kripto", "Crypto wallet"], brokerage: ["Sekuritas", "Brokerage"], gold: ["Emas", "Gold"], property: ["Properti", "Property"], other: ["Lainnya", "Other"],
};
const TX_TYPE: Record<string, [string, string]> = {
  income: ["Pemasukan", "Income"], expense: ["Pengeluaran", "Expense"], transfer: ["Transfer", "Transfer"], opening: ["Saldo awal", "Opening balance"],
  buy: ["Beli", "Buy"], sell: ["Jual", "Sell"], adjustment: ["Penyesuaian", "Adjustment"],
  borrow: ["Pinjam", "Borrow"], lend: ["Beri pinjaman", "Lend"], repay: ["Bayar utang", "Repayment"], collect: ["Terima piutang", "Collection"],
};
const DEBT_KIND: Record<string, [string, string]> = {
  personal: ["Pinjaman pribadi", "Personal loan"], credit_card: ["Kartu kredit", "Credit card"], mortgage: ["KPR / hipotek", "Mortgage"],
  installment: ["Cicilan", "Installment"], other: ["Lainnya", "Other"],
};

const text = (table: Record<string, [string, string]>, key: string) => {
  const row = table[key];
  return row ? row[current === "en" ? 1 : 0] : key;
};

export const assetKindLabel = (kind: string) => text(KIND, kind);
export const accountKindLabel = (kind: string) => text(ACCOUNT_KIND, kind);
export const txTypeLabel = (type: string) => text(TX_TYPE, type);
export const debtKindLabel = (kind: string) => text(DEBT_KIND, kind);
export const DEBT_KINDS = ["personal", "credit_card", "mortgage", "installment", "other"] as const;

/** "Utang dari Budi" / "Borrowed from Budi" - the headline of a debt transaction. */
export function debtTxTitle(type: string, counterparty: string): string {
  switch (type) {
    case "borrow": return pick(`Utang dari ${counterparty}`, `Borrowed from ${counterparty}`);
    case "lend": return pick(`Pinjamkan ke ${counterparty}`, `Lent to ${counterparty}`);
    case "repay": return pick(`Bayar utang ke ${counterparty}`, `Repaid ${counterparty}`);
    case "collect": return pick(`Terima dari ${counterparty}`, `Received from ${counterparty}`);
    default: return counterparty;
  }
}

export const MONTHS_SHORT = {
  id: ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};
export const MONTHS_LONG = {
  id: ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};
export const DAYS = {
  id: ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};
