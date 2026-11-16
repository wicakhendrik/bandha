import { describe, expect, it } from "vitest";
import { detectMapping, extractRows, findHeaderRow, parseAmount, parseCsv, parseDate } from "./csv";

describe("parseCsv", () => {
  it("handles quotes, embedded delimiters and line breaks, doubled quotes, CRLF and BOM", () => {
    const r = parseCsv('﻿Tanggal,Keterangan,Jumlah\r\n2026-11-01,"Makan, siang ""enak""",-50000\r\n2026-11-02,"baris\nkedua",100000\r\n\r\n');
    expect(r.delimiter).toBe(",");
    expect(r.rows).toEqual([
      ["Tanggal", "Keterangan", "Jumlah"],
      ["2026-11-01", 'Makan, siang "enak"', "-50000"],
      ["2026-11-02", "baris\nkedua", "100000"],
    ]);
  });

  it("detects semicolon and tab delimiters, and ignores delimiters inside quotes", () => {
    expect(parseCsv("a;b;c\n1;2;3").delimiter).toBe(";");
    expect(parseCsv("a\tb\tc\n1\t2\t3").rows[1]).toEqual(["1", "2", "3"]);
    expect(parseCsv('"a,b,c";d\n"1,2";3').rows[1]).toEqual(["1,2", "3"]);
  });

  it("does not need a trailing newline and keeps empty cells", () => {
    expect(parseCsv("a,b,c\n1,,3").rows[1]).toEqual(["1", "", "3"]);
  });
});

describe("parseAmount", () => {
  it.each([
    ["50000", "50000"], ["-50000", "-50000"], ["+50000", "50000"], ["50.000", "50000"], ["1.234.567", "1234567"],
    ["1.234.567,89", "1234567.89"], ["1,234,567.89", "1234567.89"], ["Rp 50.000", "50000"], ["Rp1.500.000,50", "1500000.5"],
    ["(25.000)", "-25000"], ["50.000 DB", "-50000"], ["50.000 CR", "50000"], ["12,5", "12.5"], ["0,50", "0.5"], ["0.500", "0.5"],
    ["100.00", "100"], ["1,5", "1.5"], ["−75000", "-75000"], ["75000-", "-75000"], ["0", "0"], ["000", "0"], ["-0", "0"],
  ])("%s -> %s", (raw, out) => expect(parseAmount(raw)).toBe(out));

  it("rejects anything that is not a number", () => {
    for (const bad of ["", "abc", "12a", "Rp", "-", "1.2.3,4,5x", "--5"]) expect(parseAmount(bad), bad).toBeNull();
  });
});

describe("parseDate", () => {
  it("reads the usual statement formats", () => {
    expect(parseDate("2026-11-15")).toEqual({ day: "2026-11-15", time: null });
    expect(parseDate("15/11/2026")).toEqual({ day: "2026-11-15", time: null });
    expect(parseDate("15-11-26")).toEqual({ day: "2026-11-15", time: null });
    expect(parseDate("5.1.2026")).toEqual({ day: "2026-01-05", time: null });
    expect(parseDate("15 Nov 2026")).toEqual({ day: "2026-11-15", time: null });
    expect(parseDate("3 Mei 2026 08:30")).toEqual({ day: "2026-05-03", time: "08:30" });
    expect(parseDate("20 Agustus 2026")).toEqual({ day: "2026-08-20", time: null });
    expect(parseDate("2026-11-15T08:05:00")).toEqual({ day: "2026-11-15", time: "08:05" });
    expect(parseDate("15/11/2026 23:59")).toEqual({ day: "2026-11-15", time: "23:59" });
  });
  it("day-first by default, month-first when asked", () => {
    expect(parseDate("03/04/2026")).toEqual({ day: "2026-04-03", time: null });
    expect(parseDate("03/04/2026", "mdy")).toEqual({ day: "2026-03-04", time: null });
  });
  it("rejects dates that do not exist or are not dates", () => {
    for (const bad of ["31/02/2026", "2026-13-01", "32/01/2026", "hello", "", "15 Foo 2026", "1/2"]) expect(parseDate(bad), bad).toBeNull();
    expect(parseDate("29/02/2028")).not.toBeNull();
    expect(parseDate("29/02/2027")).toBeNull();
  });
});

describe("column detection", () => {
  it("maps Indonesian and English headers", () => {
    expect(detectMapping(["Tanggal", "Keterangan", "Jumlah"])).toEqual({ date: 0, description: 1, amount: 2, debit: null, credit: null, category: null });
    expect(detectMapping(["Date", "Description", "Amount", "Category", "Balance"])).toMatchObject({ date: 0, description: 1, amount: 2, category: 3 });
  });
  it("prefers debit and credit columns over a redundant amount", () => {
    expect(detectMapping(["Tgl", "Uraian", "Debet", "Kredit", "Saldo"])).toEqual({ date: 0, description: 1, amount: null, debit: 2, credit: 3, category: null });
  });
  it("skips account info above the header", () => {
    const rows = [["Rekening", "1234567"], ["Periode", "Nov 2026"], ["Tanggal", "Keterangan", "Debet", "Kredit"], ["01/11/2026", "x", "1.000", ""]];
    expect(findHeaderRow(rows)).toBe(2);
    expect(findHeaderRow([["a", "b"], ["1", "2"]])).toBe(0);
  });
});

describe("extractRows", () => {
  const map = { date: 0, description: 1, amount: 2, debit: null, credit: null, category: 3 };
  it("signed amounts: minus is expense, plus is income; keeps order, category, time", () => {
    const r = extractRows(
      [["01/11/2026", "Kopi", "-25.000", "Makan"], ["02/11/2026 09:15", "Gaji", "5.000.000", ""]],
      2, map, "dmy",
    );
    expect(r.problems).toEqual([]);
    expect(r.rows).toEqual([
      { line: 2, day: "2026-11-01", time: null, description: "Kopi", category: "Makan", type: "expense", amount: "25000" },
      { line: 3, day: "2026-11-02", time: "09:15", description: "Gaji", category: null, type: "income", amount: "5000000" },
    ]);
  });

  it("debit and credit columns decide the type; both filled or none is a problem", () => {
    const m = { date: 0, description: 1, amount: null, debit: 2, credit: 3, category: null };
    const r = extractRows(
      [["01/11/2026", "a", "10.000", ""], ["02/11/2026", "b", "", "20.000"], ["03/11/2026", "c", "1", "1"], ["04/11/2026", "d", "", ""], ["05/11/2026", "e", "0", "0"]],
      2, m, "dmy",
    );
    expect(r.rows.map((x) => [x.type, x.amount])).toEqual([["expense", "10000"], ["income", "20000"]]);
    expect(r.problems.map((p) => p.error)).toEqual(["Debit dan kredit sama-sama terisi", "Jumlah kosong atau nol", "Jumlah kosong atau nol"]);
  });

  it("reports unreadable rows with their line, silently skips blank and total rows", () => {
    const r = extractRows(
      [["bukan tanggal", "x", "1000", ""], ["01/11/2026", "x", "abc", ""], ["01/11/2026", "x", "0", ""], ["", "Saldo akhir", "", ""], ["", "", "", ""], ["31/02/2026", "x", "5", ""]],
      2, map, "dmy",
    );
    expect(r.rows).toEqual([]);
    expect(r.skipped).toBe(2);
    expect(r.problems.map((p) => [p.line, p.error])).toEqual([
      [2, 'Tanggal tidak dikenali: "bukan tanggal"'], [3, 'Jumlah bukan angka: "abc"'], [4, "Jumlah nol"], [7, 'Tanggal tidak dikenali: "31/02/2026"'],
    ]);
  });

  it("trims and caps descriptions", () => {
    const r = extractRows([["01/11/2026", `  banyak   spasi ${"x".repeat(300)}`, "5000", ""]], 2, map, "dmy");
    expect(r.rows[0]!.description.startsWith("banyak spasi x")).toBe(true);
    expect(r.rows[0]!.description).toHaveLength(200);
  });
});
