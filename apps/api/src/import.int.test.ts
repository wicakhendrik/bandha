import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ledgerEntries, seedAssets } from "@bandha/db";
import { assetIds, call, db, newUser, pool, type Json } from "./test-utils";

let IDR = "";
beforeAll(async () => {
  await seedAssets(db);
  IDR = (await assetIds((await newUser()).token))["IDR"]!;
});
afterAll(async () => { await pool.end(); });

const bank = async (token: string, opening = "1000000") =>
  (await call("POST", "/accounts", token, { name: "BCA", kind: "bank", openingBalance: { assetId: IDR, quantity: opening } })).json.account.id as string;
const balance = async (token: string, accountId: string) => {
  const list = (await call("GET", "/accounts", token)).json.accounts as Json[];
  return list.find((a) => a.id === accountId)?.balances.find((b: Json) => b.symbol === "IDR")?.quantity ?? "0";
};
const nets = async (workspaceId: string) => {
  const [sum] = await db.select({ s: sql<string>`sum(${ledgerEntries.functionalAmount})` }).from(ledgerEntries).where(eq(ledgerEntries.workspaceId, workspaceId));
  expect(Number(sum?.s)).toBe(0);
};
const preview = (token: string, accountId: string, csv: string, extra: Json = {}) => call("POST", "/imports/preview", token, { accountId, csv, ...extra });
const commit = (token: string, accountId: string, rows: Json[], batchKey = `b-${randomUUID()}`) => call("POST", "/imports", token, { accountId, batchKey, rows });
const pick = (r: Json) => ({ day: r.day, time: r.time, description: r.description, category: r.category, type: r.type, amount: r.amount });

const STATEMENT = [
  "Tanggal,Keterangan,Jumlah,Kategori",
  '01/11/2026,"Kopi, Kenangan",-25.000,Makan',
  "02/11/2026,Gaji November,5.000.000,",
  "03/11/2026,Bensin,-60.000,Transport",
  "",
  ",Saldo akhir,,",
].join("\n");

describe("CSV import", () => {
  it("previews without writing anything, then imports exactly the chosen rows", async () => {
    const u = await newUser();
    const acc = await bank(u.token);
    const p = await preview(u.token, acc, STATEMENT);
    expect(p.status).toBe(200);
    expect(p.json).toMatchObject({ delimiter: ",", headers: ["Tanggal", "Keterangan", "Jumlah", "Kategori"], needsMapping: false });
    expect(p.json.mapping).toEqual({ date: 0, description: 1, amount: 2, debit: null, credit: null, category: 3 });
    expect(p.json.summary).toEqual({ records: 4, readable: 3, duplicates: 0, problems: 0, skipped: 1, income: "5000000", expense: "85000" });
    expect(p.json.rows[0]).toMatchObject({ day: "2026-11-01", description: "Kopi, Kenangan", type: "expense", amount: "25000", category: "Makan", duplicate: false });
    expect(await balance(u.token, acc)).toBe("1000000"); // nothing written

    const c = await commit(u.token, acc, p.json.rows.map(pick));
    expect(c.status).toBe(201);
    expect(c.json).toMatchObject({ imported: 3, replayed: false });
    expect(await balance(u.token, acc)).toBe("5915000"); // 1.000.000 + 5.000.000 - 25.000 - 60.000

    const list = (await call("GET", "/transactions?limit=10", u.token)).json.transactions as Json[];
    const kopi = list.find((t) => t.description === "Kopi, Kenangan")!;
    expect(kopi).toMatchObject({ type: "expense", category: "Makan", tags: ["import"] });
    expect(new Date(kopi.occurredAt).toISOString()).toBe("2026-11-01T05:00:00.000Z"); // 12:00 Jakarta
    // imported income/expense feed the same cashflow as hand-entered ones
    const detail = (await call("GET", "/dashboard/cashflow/expense?month=2026-11", u.token)).json;
    expect(detail.total).toBe("85000");
    await nets(u.workspaceId);
  });

  it("flags rows already in the account as duplicates, by count", async () => {
    const u = await newUser();
    const acc = await bank(u.token);
    const first = await preview(u.token, acc, STATEMENT);
    await commit(u.token, acc, first.json.rows.map(pick));

    const again = await preview(u.token, acc, STATEMENT);
    expect(again.json.summary).toMatchObject({ readable: 3, duplicates: 3, income: "0", expense: "0" });
    expect(again.json.rows.every((r: Json) => r.duplicate)).toBe(true);

    // two identical coffees in one file: one is already booked, so exactly one is new
    const csv = ["Tanggal,Keterangan,Jumlah", '01/11/2026,"Kopi, Kenangan",-25.000', '01/11/2026,"Kopi, Kenangan",-25.000'].join("\n");
    const p = await preview(u.token, acc, csv);
    expect(p.json.rows.map((r: Json) => r.duplicate)).toEqual([true, false]);
    // case and spacing do not matter; a different amount or day is not a duplicate
    const p2 = await preview(u.token, acc, ["Tanggal,Keterangan,Jumlah", '01/11/2026,"KOPI,   KENANGAN",-25.000', '01/11/2026,"Kopi, Kenangan",-26.000', '02/11/2026,"Kopi, Kenangan",-25.000'].join("\n"));
    expect(p2.json.rows.map((r: Json) => r.duplicate)).toEqual([true, false, false]);
  });

  it("reads debit/credit statements with account info above the header, semicolons and English months", async () => {
    const u = await newUser();
    const acc = await bank(u.token, "0");
    const csv = [
      "Rekening;1234567890", "Periode;November 2026", "",
      "Tgl;Uraian;Debet;Kredit;Saldo",
      "01 Nov 2026;Transfer masuk;;1.500.000,00;1.500.000,00",
      "05 Nov 2026 14:30;Listrik PLN;350.000,00;;1.150.000,00",
    ].join("\n");
    const p = await preview(u.token, acc, csv);
    expect(p.json.delimiter).toBe(";");
    expect(p.json.mapping).toMatchObject({ date: 0, description: 1, debit: 2, credit: 3, amount: null });
    expect(p.json.rows.map((r: Json) => [r.day, r.time, r.type, r.amount])).toEqual([
      ["2026-11-01", null, "income", "1500000"], ["2026-11-05", "14:30", "expense", "350000"],
    ]);
    await commit(u.token, acc, p.json.rows.map(pick));
    expect(await balance(u.token, acc)).toBe("1150000");
    const t = ((await call("GET", "/transactions", u.token)).json.transactions as Json[]).find((x) => x.description === "Listrik PLN")!;
    expect(new Date(t.occurredAt).toISOString()).toBe("2026-11-05T07:30:00.000Z");
  });

  it("reports unreadable rows with their line, and asks for a mapping when columns cannot be found", async () => {
    const u = await newUser();
    const acc = await bank(u.token);
    const p = await preview(u.token, acc, ["Tanggal,Keterangan,Jumlah", "bukan-tanggal,x,1000", "01/11/2026,x,abc", "01/11/2026,ok,1000"].join("\n"));
    expect(p.json.summary).toMatchObject({ readable: 1, problems: 2 });
    expect(p.json.problems.map((x: Json) => [x.line, x.error])).toEqual([[2, 'Tanggal tidak dikenali: "bukan-tanggal"'], [3, 'Jumlah bukan angka: "abc"']]);

    const odd = await preview(u.token, acc, "kolom1,kolom2,kolom3\n01/11/2026,x,1000");
    expect(odd.json.needsMapping).toBe(true);
    expect(odd.json.rows).toEqual([]);
    // the user maps the columns by hand
    const mapped = await preview(u.token, acc, "kolom1,kolom2,kolom3\n01/11/2026,x,1000", { mapping: { date: 0, description: 1, amount: 2, debit: null, credit: null, category: null } });
    expect(mapped.json.needsMapping).toBe(false);
    expect(mapped.json.rows).toHaveLength(1);
    // month-first dates on request
    const us = await preview(u.token, acc, "Date,Description,Amount\n03/04/2026,x,100", { dateOrder: "mdy" });
    expect(us.json.rows[0].day).toBe("2026-03-04");
    // a mapping that points outside the file is refused
    expect((await preview(u.token, acc, "a,b\n1,2", { mapping: { date: 9, description: null, amount: 1, debit: null, credit: null, category: null } })).status).toBe(400);
  });

  it("is idempotent per batch and can be undone as a whole", async () => {
    const u = await newUser();
    const acc = await bank(u.token);
    const rows = (await preview(u.token, acc, STATEMENT)).json.rows.map(pick) as Json[];
    const key = `batch-${randomUUID()}`;
    const a = await commit(u.token, acc, rows, key);
    const b = await commit(u.token, acc, rows, key);
    expect([a.status, b.status]).toEqual([201, 200]);
    expect(b.json).toMatchObject({ imported: 3, replayed: true });
    expect(await balance(u.token, acc)).toBe("5915000"); // posted once

    const undo = await call("POST", `/imports/${key}/undo`, u.token);
    expect(undo.json).toEqual({ voided: 3 });
    expect(await balance(u.token, acc)).toBe("1000000");
    expect((await call("POST", `/imports/${key}/undo`, u.token)).status).toBe(404);
    expect((await call("GET", "/dashboard/cashflow/expense?month=2026-11", u.token)).json.total).toBe("0");
    await nets(u.workspaceId);
  });

  it("is all or nothing, validates every row, and stays inside the workspace", async () => {
    const u = await newUser();
    const other = await newUser();
    const acc = await bank(u.token);
    const good = { day: "2026-11-01", description: "ok", type: "expense", amount: "1000" };

    expect((await commit(u.token, acc, [good, { ...good, amount: "0" }])).status).toBe(400);
    expect((await commit(u.token, acc, [good, { ...good, day: "2026-02-31" }])).status).toBe(400);
    expect((await commit(u.token, acc, [good, { ...good, type: "transfer" }])).status).toBe(400);
    expect((await commit(u.token, acc, [])).status).toBe(400);
    expect((await call("POST", "/imports", u.token, { accountId: acc, batchKey: "bad key!", rows: [good] })).status).toBe(400);
    expect((await commit(u.token, acc, Array.from({ length: 2001 }, () => good))).status).toBe(400);
    expect(await balance(u.token, acc)).toBe("1000000");

    // someone else's account, and unauthenticated access
    const theirs = await bank(other.token);
    expect((await commit(u.token, theirs, [good])).status).toBe(404);
    expect((await preview(u.token, theirs, STATEMENT)).status).toBe(404);
    expect((await call("POST", "/imports/preview", null, { accountId: acc, csv: STATEMENT })).status).toBe(401);
    // another user cannot undo my batch
    const key = `batch-${randomUUID()}`;
    await commit(u.token, acc, [good], key);
    expect((await call("POST", `/imports/${key}/undo`, other.token)).status).toBe(404);
    expect(await balance(u.token, acc)).toBe("999000");

    // an empty or oversized file is refused with a reason
    expect((await preview(u.token, acc, "")).status).toBe(400);
    expect((await preview(u.token, acc, "Tanggal,Jumlah\n" + "01/11/2026,100\n".repeat(2001))).status).toBe(400);
  });

  it("imports a large statement in one go", async () => {
    const u = await newUser();
    const acc = await bank(u.token, "0");
    const lines = ["Tanggal,Keterangan,Jumlah"];
    for (let i = 0; i < 1500; i++) lines.push(`${String((i % 28) + 1).padStart(2, "0")}/10/2026,Belanja ${i},-1.000`);
    const p = await preview(u.token, acc, lines.join("\n"));
    expect(p.json.summary).toMatchObject({ readable: 1500, duplicates: 0, expense: "1500000" });
    const c = await commit(u.token, acc, p.json.rows.map(pick));
    expect(c.json.imported).toBe(1500);
    expect(await balance(u.token, acc)).toBe("-1500000");
    await nets(u.workspaceId);
  });
});
