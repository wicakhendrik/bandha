import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { journals, ledgerEntries, seedAssets } from "@bandha/db";
import { assetIds, call, db, newUser, pool, type Json } from "./test-utils";

let IDR = "";
let BTC = "";
beforeAll(async () => {
  await seedAssets(db);
  const ids = await assetIds((await newUser()).token);
  IDR = ids["IDR"]!;
  BTC = ids["BTC"]!;
});
afterAll(async () => { await pool.end(); });

const bank = async (token: string, name = "BCA", opening = "1000000") =>
  (await call("POST", "/accounts", token, { name, kind: "bank", openingBalance: { assetId: IDR, quantity: opening } })).json.account.id as string;
const balance = async (token: string, accountId: string, symbol = "IDR") => {
  const list = (await call("GET", "/accounts", token)).json.accounts as Json[];
  return list.find((a) => a.id === accountId)?.balances.find((b: Json) => b.symbol === symbol)?.quantity ?? "0";
};
const nets = async (workspaceId: string) => {
  const [sum] = await db.select({ s: sql<string>`sum(${ledgerEntries.functionalAmount})` }).from(ledgerEntries).where(eq(ledgerEntries.workspaceId, workspaceId));
  expect(Number(sum?.s)).toBe(0);
};
const editable = async (token: string, id: string) => (await call("GET", `/transactions/${id}`, token)).json.transaction as Json;
const put = (token: string, id: string, body: Json) => call("PUT", `/transactions/${id}`, token, body);
const strip = ({ id: _i, ...rest }: Json) => rest;

describe("editing a posted transaction", () => {
  it("replaces an expense: balance, cashflow and list show the new values once", async () => {
    const u = await newUser();
    const acc = await bank(u.token);
    const id = (await call("POST", "/transactions", u.token, { type: "expense", accountId: acc, assetId: IDR, quantity: "86000", category: "Makan" })).json.transaction.id as string;
    expect(await balance(u.token, acc)).toBe("914000");

    const form = await editable(u.token, id);
    expect(form).toMatchObject({ type: "expense", accountId: acc, assetId: IDR, quantity: "86000", category: "Makan" });

    const when = new Date(Date.now() - 86_400_000); // yesterday
    const monthKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(when).slice(0, 7);
    const res = await put(u.token, id, { ...strip(form), quantity: "120000", category: "Makan malam", description: "Sate", occurredAt: when.toISOString() });
    expect(res.status).toBe(204);
    expect(await balance(u.token, acc)).toBe("880000");

    // never double counted: the original journal is reversed, only the replacement is live
    const detail = (await call("GET", `/dashboard/cashflow/expense?month=${monthKey}`, u.token)).json;
    expect(detail.total).toBe("120000");
    expect(detail.categories).toHaveLength(1);
    expect(detail.categories[0]).toMatchObject({ category: "Makan malam", total: "120000" });

    const list = (await call("GET", "/transactions", u.token)).json.transactions as Json[];
    const tx = list.find((t) => t.id === id)!;
    expect(tx).toMatchObject({ description: "Sate", category: "Makan malam", editable: true });
    expect(tx.legs).toHaveLength(1);
    expect(Number(tx.legs[0].quantity)).toBe(-120000);
    expect(new Date(tx.occurredAt).toISOString()).toBe(when.toISOString());

    const ledger = (await call("GET", `/accounts/${acc}/ledger`, u.token)).json;
    expect(ledger.rows.filter((r: Json) => r.transactionId === id)).toHaveLength(1);

    // the audit trail keeps all three journals: original, its reversal, the replacement
    const js = await db.select().from(journals).where(eq(journals.transactionId, id));
    expect(js).toHaveLength(3);
    expect(js.filter((j) => j.reversesJournalId)).toHaveLength(1);

    // voiding after an edit removes the edited amount, not the original one
    expect((await call("POST", `/transactions/${id}/void`, u.token)).status).toBe(204);
    expect(await balance(u.token, acc)).toBe("1000000");
    expect((await call("GET", `/dashboard/cashflow/expense?month=${monthKey}`, u.token)).json.total).toBe("0");
    await nets(u.workspaceId);
  });

  it("every type round-trips through GET and PUT without changing anything", async () => {
    const u = await newUser();
    const a = await bank(u.token, "BCA", "5000000");
    const b = await bank(u.token, "GoPay", "0");
    const ids: Record<string, string> = {};
    const post = async (name: string, body: Json) => {
      const r = await call("POST", "/transactions", u.token, body);
      expect(r.status, name).toBe(201);
      ids[name] = r.json.transaction.id;
    };
    await post("income", { type: "income", accountId: a, assetId: IDR, quantity: "300000", category: "Gaji" });
    await post("expense", { type: "expense", accountId: a, assetId: IDR, quantity: "50000" });
    await post("transfer", { type: "transfer", fromAccountId: a, toAccountId: b, assetId: IDR, quantity: "100000" });
    await post("buy", { type: "buy", accountId: a, fundingAccountId: b, assetId: BTC, quantity: "0.01", totalCost: "70000", fee: "1500" });
    await post("sell", { type: "sell", accountId: a, receivingAccountId: b, assetId: BTC, quantity: "0.004", proceeds: "40000", fee: "500" });

    const before = { a: await balance(u.token, a), b: await balance(u.token, b), btc: await balance(u.token, a, "BTC") };
    const pfBefore = (await call("GET", "/portfolio", u.token)).json.totals;

    for (const name of ["income", "expense", "transfer"]) {
      const form = await editable(u.token, ids[name]!);
      expect((await put(u.token, ids[name]!, strip(form))).status, name).toBe(204);
    }
    // buy has a later sell on the same account and asset, so it is protected; the sell itself is editable
    const sell = await editable(u.token, ids["sell"]!);
    expect(sell).toMatchObject({ type: "sell", accountId: a, receivingAccountId: b, proceeds: "40000", fee: "500", quantity: "0.004" });
    expect((await put(u.token, ids["sell"]!, strip(sell))).status).toBe(204);
    const buy = await editable(u.token, ids["buy"]!);
    expect(buy).toMatchObject({ type: "buy", accountId: a, fundingAccountId: b, totalCost: "70000", fee: "1500", quantity: "0.01" });
    const blocked = await put(u.token, ids["buy"]!, strip(buy));
    expect(blocked.status).toBe(409);
    expect(blocked.json.error).toContain("dipakai transaksi lain");

    expect({ a: await balance(u.token, a), b: await balance(u.token, b), btc: await balance(u.token, a, "BTC") }).toEqual(before);
    expect((await call("GET", "/portfolio", u.token)).json.totals).toEqual(pfBefore);
    await nets(u.workspaceId);
  });

  it("editing a sale recomputes its realised profit from the average cost", async () => {
    const u = await newUser();
    const acc = await bank(u.token, "Indodax", "1000000");
    await call("POST", "/transactions", u.token, { type: "buy", accountId: acc, assetId: BTC, quantity: "1", totalCost: "100000" });
    const sellId = (await call("POST", "/transactions", u.token, { type: "sell", accountId: acc, assetId: BTC, quantity: "0.5", proceeds: "70000" })).json.transaction.id as string;
    const realized = async () => (await call("GET", "/portfolio", u.token)).json.totals.realizedPnl as string;
    expect(await realized()).toBe("20000"); // 70.000 - 0,5 x 100.000

    const form = await editable(u.token, sellId);
    expect((await put(u.token, sellId, { ...strip(form), quantity: "0.25", proceeds: "40000" })).status).toBe(204);
    expect(await realized()).toBe("15000"); // 40.000 - 0,25 x 100.000
    expect(await balance(u.token, acc, "BTC")).toBe("0.75");
    expect(await balance(u.token, acc)).toBe("940000"); // 1.000.000 - 100.000 + 40.000

    // selling more than is held is refused and leaves everything as it was
    const tooMuch = await put(u.token, sellId, { ...strip(form), quantity: "1.5", proceeds: "70000" });
    expect(tooMuch.status).toBe(400);
    expect(await balance(u.token, acc, "BTC")).toBe("0.75");
    expect(await realized()).toBe("15000");
    await nets(u.workspaceId);
  });

  it("a buy can be corrected once nothing after it uses that asset", async () => {
    const u = await newUser();
    const acc = await bank(u.token, "Tokocrypto", "1000000");
    const buyId = (await call("POST", "/transactions", u.token, { type: "buy", accountId: acc, assetId: BTC, quantity: "1", totalCost: "100000" })).json.transaction.id as string;
    const sellId = (await call("POST", "/transactions", u.token, { type: "sell", accountId: acc, assetId: BTC, quantity: "0.5", proceeds: "70000" })).json.transaction.id as string;
    const form = await editable(u.token, buyId);
    expect((await put(u.token, buyId, { ...strip(form), totalCost: "120000" })).status).toBe(409);
    expect((await call("POST", `/transactions/${sellId}/void`, u.token)).status).toBe(204);
    expect((await put(u.token, buyId, { ...strip(form), totalCost: "120000" })).status).toBe(204);
    expect(await balance(u.token, acc)).toBe("880000");
    const pf = (await call("GET", "/portfolio", u.token)).json;
    expect(pf.totals.costBasis).toBe("120000");
    await nets(u.workspaceId);
  });

  it("edits an opening balance: IDR freely, and the account balance follows", async () => {
    const u = await newUser();
    const acc = await bank(u.token, "BCA", "1000000");
    const opening = ((await call("GET", "/transactions", u.token)).json.transactions as Json[]).find((t) => t.type === "opening")!;
    expect(opening.editable).toBe(true);
    const form = await editable(u.token, opening.id);
    expect(form).toMatchObject({ type: "opening", accountId: acc, assetId: IDR, quantity: "1000000" });
    expect((await put(u.token, opening.id, { type: "opening", quantity: "2500000", description: form.description })).status).toBe(204);
    expect(await balance(u.token, acc)).toBe("2500000");
    expect((await call("GET", "/dashboard", u.token)).json.netWorth).toBe("2500000");
    await nets(u.workspaceId);
  });

  it("refuses what it must: type change, voided, debt transactions, other workspaces, bad input", async () => {
    const u = await newUser();
    const other = await newUser();
    const acc = await bank(u.token);
    const id = (await call("POST", "/transactions", u.token, { type: "expense", accountId: acc, assetId: IDR, quantity: "1000" })).json.transaction.id as string;

    expect((await put(u.token, id, { type: "income", accountId: acc, assetId: IDR, quantity: "1000" })).status).toBe(400);
    expect((await put(u.token, id, { type: "expense", accountId: acc, assetId: IDR, quantity: "0" })).status).toBe(400);
    // another user can neither read nor change it, nor move it onto their own account
    expect((await call("GET", `/transactions/${id}`, other.token)).status).toBe(404);
    expect((await put(other.token, id, { type: "expense", accountId: await bank(other.token), assetId: IDR, quantity: "5" })).status).toBe(404);
    expect((await put(u.token, id, { type: "expense", accountId: await bank(other.token), assetId: IDR, quantity: "5" })).status).toBe(404);
    expect((await call("GET", `/transactions/${id}`, null)).status).toBe(401);
    expect(await balance(u.token, acc)).toBe("999000");

    // debts are edited from the debt page
    const debt = (await call("POST", "/debts", u.token, { direction: "payable", counterparty: "Budi", principal: "50000", accountId: acc })).json.debt.id as string;
    const debtTx = ((await call("GET", "/transactions", u.token)).json.transactions as Json[]).find((t) => t.type === "borrow")!;
    expect(debtTx.editable).toBe(false);
    expect((await call("GET", `/transactions/${debtTx.id}`, u.token)).status).toBe(409);
    expect((await put(u.token, debtTx.id, { type: "income", accountId: acc, assetId: IDR, quantity: "1" })).status).toBe(409);
    expect(debt).toBeTruthy();

    await call("POST", `/transactions/${id}/void`, u.token);
    expect((await put(u.token, id, { type: "expense", accountId: acc, assetId: IDR, quantity: "5" })).status).toBe(409);
    await nets(u.workspaceId);
  });

  it("two concurrent edits of one transaction cannot both apply twice", async () => {
    const u = await newUser();
    const acc = await bank(u.token);
    const id = (await call("POST", "/transactions", u.token, { type: "expense", accountId: acc, assetId: IDR, quantity: "1000" })).json.transaction.id as string;
    const res = await Promise.all([2000, 3000, 4000].map((q) => put(u.token, id, { type: "expense", accountId: acc, assetId: IDR, quantity: String(q) })));
    expect(res.every((r) => r.status === 204)).toBe(true);
    const final = (await editable(u.token, id)).quantity as string;
    expect(await balance(u.token, acc)).toBe(String(1_000_000 - Number(final)));
    await nets(u.workspaceId);
  });
});
