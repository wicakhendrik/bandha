// Display-only helpers. Money stays a decimal string everywhere else; Number() is used here purely to
// render. Deliberately no Intl: output must be identical on Hermes (Android/iOS), Node and browsers.

import { DAYS, MONTHS_LONG, MONTHS_SHORT, getLang } from "./i18n";

const JAKARTA_OFFSET_MS = 7 * 3_600_000;

/** Wall-clock parts in Asia/Jakarta (no DST), via UTC arithmetic. */
function jakarta(d: Date) {
  const j = new Date(d.getTime() + JAKARTA_OFFSET_MS);
  return { y: j.getUTCFullYear(), m: j.getUTCMonth(), d: j.getUTCDate(), h: j.getUTCHours() };
}

// Indonesian: 1.234.567,89   English: 1,234,567.89
const thousands = () => (getLang() === "en" ? "," : ".");
const decimalMark = () => (getLang() === "en" ? "." : ",");
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, thousands());

export function rp(value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const r = Math.round(Math.abs(n));
  return `${n < 0 && r !== 0 ? "−" : ""}Rp ${group(String(r))}`;
}

/** Rupiah with an explicit sign, for profit/loss: "+Rp 5.500.000", "−Rp 1.000.000", "Rp 0". */
export function signedRp(value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const r = Math.round(Math.abs(n));
  return `${r === 0 ? "" : n < 0 ? "−" : "+"}Rp ${group(String(r))}`;
}

/** Percentage with a decimal comma and explicit sign: "+57,89%". */
export function pct(value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const s = Math.abs(n).toFixed(2).replace(".", decimalMark());
  return `${n === 0 ? "" : n < 0 ? "−" : "+"}${s}%`;
}

/** Asset quantity: up to 8 decimals, trailing zeros trimmed, Indonesian separators. */
export function qty(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  const [int = "0", frac = ""] = Math.abs(n).toFixed(8).replace(/0+$/, "").replace(/\.$/, "").split(".");
  return `${n < 0 ? "−" : ""}${group(int)}${frac ? `${decimalMark()}${frac}` : ""}`;
}

export function dateShort(iso: string): string {
  const p = jakarta(new Date(iso));
  return `${p.d} ${MONTHS_SHORT[getLang()][p.m]}`;
}

export function dateLong(d: Date): string {
  const p = jakarta(d);
  const dow = DAYS[getLang()][new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay()];
  return `${dow}, ${p.d} ${MONTHS_LONG[getLang()][p.m]} ${p.y}`;
}

/** "November 2026" for a "YYYY-MM" key. */
export function monthYear(ym: string): string {
  return `${MONTHS_LONG[getLang()][Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(0, 4)}`;
}

/** The "YYYY-MM" key a number of months away from another (negative = earlier). */
export function shiftMonth(ym: string, by: number): string {
  const idx = Number(ym.slice(0, 4)) * 12 + (Number(ym.slice(5, 7)) - 1) + by;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" in Asia/Jakarta. */
export function todayKey(d: Date = new Date()): string {
  const p = jakarta(d);
  return `${p.y}-${String(p.m + 1).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export const monthLabel = (ym: string) => MONTHS_SHORT[getLang()][Number(ym.slice(5, 7)) - 1] ?? ym;

export function greeting(d: Date = new Date()): string {
  const h = jakarta(d).h;
  if (getLang() === "en") return h < 11 ? "Good morning" : h < 15 ? "Good afternoon" : h < 18 ? "Good evening" : "Good night";
  return h < 11 ? "Sugeng enjang" : h < 15 ? "Sugeng siang" : h < 18 ? "Sugeng sonten" : "Sugeng ndalu";
}

// Indonesian constants kept for the mobile app; the web uses assetKindLabel/accountKindLabel (language aware).
export const KIND_LABEL: Record<string, string> = {
  fiat: "Kas & bank", crypto: "Kripto", gold: "Emas", stock: "Saham", fund: "Reksa dana", other: "Lainnya",
};
export const ACCOUNT_KIND_LABEL: Record<string, string> = {
  cash: "Tunai", bank: "Bank", ewallet: "Dompet digital", exchange: "Bursa kripto", wallet: "Dompet kripto", brokerage: "Sekuritas",
  gold: "Emas", property: "Properti", other: "Lainnya",
};

export const isAmount = (v: string) => /^\d+(\.\d{1,18})?$/.test(v) && !/^0+(\.0+)?$/.test(v);
export const isAmountOrZero = (v: string) => /^\d+(\.\d{1,18})?$/.test(v);
export const isDateKey = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T12:00:00+07:00`).getTime());

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
}
