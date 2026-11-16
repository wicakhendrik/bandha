/**
 * Pure CSV import logic: parsing, column detection, and turning bank-statement cells into dates and amounts.
 * No database and no I/O here, so every rule can be tested on its own. The text of an upload is never logged.
 */

export type DateOrder = "dmy" | "mdy";

/* ───────── Parsing ───────── */

const DELIMITERS = [",", ";", "\t", "|"] as const;

/** Picks the delimiter that appears most (outside quotes) on the first non-empty lines. */
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "").slice(0, 10);
  let best = ",";
  let bestScore = 0;
  for (const d of DELIMITERS) {
    let score = 0;
    for (const line of lines) {
      let q = false;
      for (const ch of line) {
        if (ch === '"') q = !q;
        else if (ch === d && !q) score++;
      }
    }
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

/** RFC 4180 style: quoted fields may contain delimiters, line breaks and doubled quotes. Blank lines are dropped. */
export function parseCsv(input: string): { delimiter: string; rows: string[][] } {
  const text = input.replace(/^﻿/, "");
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const endRow = () => {
    row.push(cell.trim());
    cell = "";
    if (row.some((c) => c !== "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(cell.trim()); cell = ""; }
    else if (ch === "\n") endRow();
    else if (ch === "\r") { if (text[i + 1] === "\n") i++; endRow(); }
    else cell += ch;
  }
  if (cell !== "" || row.length > 0) endRow();
  return { delimiter, rows };
}

/* ───────── Column detection ───────── */

export const FIELDS = ["date", "description", "amount", "debit", "credit", "category"] as const;
export type Field = (typeof FIELDS)[number];
/** Column index per field, or null when the file has no such column. */
export type Mapping = Record<Field, number | null>;

const SYNONYMS: Record<Field, string[]> = {
  date: ["tanggal", "tgl", "date", "datetime", "waktu", "tanggaltransaksi", "transactiondate", "postingdate", "tanggalposting", "valuedate"],
  description: ["keterangan", "deskripsi", "description", "memo", "uraian", "narasi", "detail", "remarks", "note", "catatan", "transaksi", "berita", "payee", "merchant"],
  amount: ["jumlah", "amount", "nominal", "mutasi", "nilai", "total", "value"],
  debit: ["debit", "debet", "keluar", "pengeluaran", "withdrawal", "withdrawals", "db", "uangkeluar", "dr"],
  credit: ["kredit", "credit", "masuk", "pemasukan", "deposit", "deposits", "cr", "uangmasuk"],
  category: ["kategori", "category", "jenis", "tipe", "type"],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Which column each field most likely is, by header name (Indonesian and English). */
export function detectMapping(headers: string[]): Mapping {
  const m: Mapping = { date: null, description: null, amount: null, debit: null, credit: null, category: null };
  const used = new Set<number>();
  // Exact synonym matches first, in priority order, then looser "contains" matches.
  for (const exact of [true, false]) {
    for (const field of FIELDS) {
      if (m[field] !== null) continue;
      const idx = headers.findIndex((h, i) => {
        if (used.has(i)) return false;
        const n = norm(h);
        if (!n) return false;
        return SYNONYMS[field].some((s) => (exact ? n === s : n.length > 3 && s.length > 3 && (n.includes(s) || s.includes(n))));
      });
      if (idx >= 0) { m[field] = idx; used.add(idx); }
    }
  }
  // Separate debit and credit columns make a combined "amount" column redundant.
  if (m.debit !== null && m.credit !== null) m.amount = null;
  return m;
}

/** Statements often start with account info; the header is the first of the opening rows that looks like one. */
export function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const m = detectMapping(rows[i]!);
    if (m.date !== null && (m.amount !== null || m.debit !== null || m.credit !== null)) return i;
  }
  return 0;
}

/* ───────── Cells → values ───────── */

/**
 * A number as written in Indonesian or English statements: "1.234.567,89", "1,234,567.89", "Rp 50.000", "(25.000)",
 * "-50000", "50.000 DB". Returns a signed decimal string with a dot, or null when it is not a number.
 * A single separator followed by exactly three digits is read as thousands ("50.000" = 50000), as it nearly always is.
 */
export function parseAmount(raw: string): string | null {
  let s = raw.replace(/ /g, " ").trim();
  if (!s) return null;
  let negative = false;
  const suffix = s.match(/(?<=\d)\s*(DB|DR|CR)$/i);
  if (suffix) {
    if (suffix[1]!.toUpperCase() !== "CR") negative = true;
    s = s.slice(0, suffix.index).trim();
  }
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim(); }
  if (/^[-−]|-$/.test(s)) { negative = true; s = s.replace(/^[-−]|-$/g, "").trim(); }
  s = s.replace(/^\+/, "").replace(/^(rp\.?|idr)\s*/i, "").replace(/\s+/g, "");
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let int: string;
  let frac = "";
  if (lastDot >= 0 && lastComma >= 0) {
    const decAt = Math.max(lastDot, lastComma);
    int = s.slice(0, decAt).replace(/[.,]/g, "");
    frac = s.slice(decAt + 1);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const parts = s.split(sep);
    const last = parts[parts.length - 1]!;
    const before = parts.slice(0, -1).join("");
    if (parts.length > 2) int = parts.join("");
    else if (last.length === 3 && before !== "0" && before.length >= 1 && before.length <= 3) int = parts.join("");
    else { int = before; frac = last; }
  } else int = s;
  if (!/^\d*$/.test(int) || !/^\d*$/.test(frac)) return null;
  int = int.replace(/^0+(?=\d)/, "") || "0";
  const value = frac.replace(/0+$/, "") ? `${int}.${frac.replace(/0+$/, "")}` : int;
  return negative && value !== "0" ? `-${value}` : value;
}

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mar: 3, maret: 3, march: 3, apr: 4, april: 4,
  mei: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, agu: 8, agt: 8, agustus: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, november: 11, des: 12, desember: 12, dec: 12, december: 12,
};

export interface ParsedDate { day: string; time: string | null }

const valid = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const pad = (n: number) => String(n).padStart(2, "0");
const year = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));
const timeOf = (h?: string, mi?: string) => (h !== undefined && mi !== undefined && Number(h) < 24 && Number(mi) < 60 ? `${pad(Number(h))}:${mi}` : null);

/** "2026-11-15", "15/11/2026", "15-11-26", "15 Nov 2026", "15 Mei 2026 08:30", "2026-11-15T08:30:00". */
export function parseDate(raw: string, order: DateOrder = "dmy"): ParsedDate | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T,]+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return valid(y, mo, d) ? { day: `${y}-${pad(mo)}-${pad(d)}`, time: timeOf(m[4], m[5]) } : null;
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:[ T,]+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const [d, mo] = order === "dmy" ? [a, b] : [b, a];
    const y = year(m[3]!);
    return valid(y, mo, d) ? { day: `${y}-${pad(mo)}-${pad(d)}`, time: timeOf(m[4], m[5]) } : null;
  }
  m = s.match(/^(\d{1,2})[ -]+([A-Za-z]{3,9})\.?[ ,-]+(\d{4}|\d{2})(?:[ T,]+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const mo = MONTHS[m[2]!.toLowerCase()];
    if (!mo) return null;
    const d = Number(m[1]);
    const y = year(m[3]!);
    return valid(y, mo, d) ? { day: `${y}-${pad(mo)}-${pad(d)}`, time: timeOf(m[4], m[5]) } : null;
  }
  return null;
}

/* ───────── Rows ───────── */

export interface ImportRow {
  /** 1-based line of the record in the file (header included), for error messages. */
  line: number;
  /** "YYYY-MM-DD" and optional "HH:mm" in Asia/Jakarta. */
  day: string;
  time: string | null;
  description: string;
  category: string | null;
  type: "income" | "expense";
  /** Positive decimal string in IDR. */
  amount: string;
}
export interface RowProblem { line: number; error: string; raw: string }

export interface Extracted { rows: ImportRow[]; problems: RowProblem[]; skipped: number }

const cap = (v: string, n: number) => v.trim().replace(/\s+/g, " ").slice(0, n);

/**
 * Applies a column mapping to the data rows. A row with no date and no amount (statement totals, blank notes) is
 * skipped quietly; anything else that cannot be read becomes a problem with a plain-language reason.
 * With a single amount column, a minus sign (or DB) means expense. With debit and credit columns, debit is expense.
 */
export function extractRows(data: string[][], firstLine: number, mapping: Mapping, order: DateOrder): Extracted {
  const rows: ImportRow[] = [];
  const problems: RowProblem[] = [];
  let skipped = 0;
  const cell = (r: string[], i: number | null) => (i === null ? "" : (r[i] ?? "").trim());

  data.forEach((r, k) => {
    const line = firstLine + k;
    const rawDate = cell(r, mapping.date);
    const rawAmount = cell(r, mapping.amount);
    const rawDebit = cell(r, mapping.debit);
    const rawCredit = cell(r, mapping.credit);
    const raw = r.join(" | ").slice(0, 120);
    if (!rawDate && !rawAmount && !rawDebit && !rawCredit) { skipped++; return; }
    const fail = (error: string) => problems.push({ line, error, raw });

    const date = rawDate ? parseDate(rawDate, order) : null;
    if (!date) return fail(rawDate ? `Tanggal tidak dikenali: "${rawDate.slice(0, 30)}"` : "Tanggal kosong");

    let type: "income" | "expense";
    let amount: string;
    if (mapping.debit !== null || mapping.credit !== null) {
      const d = rawDebit ? parseAmount(rawDebit) : null;
      const c = rawCredit ? parseAmount(rawCredit) : null;
      if (rawDebit && d === null) return fail(`Debit bukan angka: "${rawDebit.slice(0, 30)}"`);
      if (rawCredit && c === null) return fail(`Kredit bukan angka: "${rawCredit.slice(0, 30)}"`);
      const dv = d && d !== "0" ? d.replace(/^-/, "") : null;
      const cv = c && c !== "0" ? c.replace(/^-/, "") : null;
      if (dv && cv) return fail("Debit dan kredit sama-sama terisi");
      if (!dv && !cv) return fail("Jumlah kosong atau nol");
      [type, amount] = dv ? ["expense", dv] : ["income", cv!];
    } else {
      const a = rawAmount ? parseAmount(rawAmount) : null;
      if (a === null) return fail(rawAmount ? `Jumlah bukan angka: "${rawAmount.slice(0, 30)}"` : "Jumlah kosong");
      if (a === "0") return fail("Jumlah nol");
      type = a.startsWith("-") ? "expense" : "income";
      amount = a.replace(/^-/, "");
    }
    const category = cap(cell(r, mapping.category), 60);
    rows.push({ line, day: date.day, time: date.time, description: cap(cell(r, mapping.description), 200), category: category || null, type, amount });
  });
  return { rows, problems, skipped };
}
