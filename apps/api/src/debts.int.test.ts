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
const netWorth = async (token: string) => (await call("GET", "/dashboard", token)).json.netWorth as string;
const ledgerNetsToZero = async (workspaceId: string) => {
  const [sum] = await db.select({ s: sql<string>`sum(${ledgerEntries.functionalAmount})` }).from(ledgerEntries).where(eq(ledgerEntries.workspaceId, workspaceId));
  expect(Number(sum?.s)).toBe(0);
};

describe("debts (utang)", () => {
  it("borrowing adds cash and a liability, so net worth is unchanged until repaid", async () => {
    const u = await newUser();
    const acc = await bank(u.token);
    expect(await netWorth(u.token)).toBe("1000000");

    const created = await call("POST", "/debts", u.token, { direction: "payable", counterparty: "Budi", principal: "500000", accountId: acc, dueDate: "2027-01-31" });
    expect(created.status).toBe(201);
    const id = created.json.debt.id as string;

    expect(await balance(u.token, acc)).toBe("1500000");
    expect(await netWorth(u.token)).toBe("1000000");
    const dash = (await call("GET", "/dashboard", u.token)).json;
    expect(dash.debts).toEqual({ payable: "500000", receivable: "0" });

    const list = (await call("GET", "/debts", u.token)).json;
    expect(list.totals).toEqual({ payable: "500000", receivable: "0" });
    expect(list.debts[0]).toMatchObject({ counterparty: "Budi", remaining: "500000", paid: "0", status: "open", dueDate: "2027-01-31" });

    // a part payment with interest: principal drops, interest is an expense
    const pay = await call("POST", `/debts/${id}/payments`, u.token, { accountId: acc, amount: "200000", interest: "10000" });
    expect(pay.status).toBe(201);
    expect(await balance(u.token, acc)).toBe("1290000");
    const detail = (await call("GET", `/debts/${id}`, u.token)).json;
    expect(detail.debt).toMatchObject({ remaining: "300000", paid: "200000", status: "open", progress: 40 });
    expect(detail.history.map((h: Json) => h.type).sort()).toEqual(["borrow", "repay"]);
    expect(detail.history.find((h: Json) => h.type === "repay")).toMatchObject({ amount: "200000", interest: "10000" });
    // net worth only drops by the interest
    expect(await netWorth(u.token)).toBe("990000");
    const cf = (await call("GET", "/dashboard/cashflow?months=1", u.token)).json.months[0];
    expect(cf.expense).toBe("10000");

    // cannot repay more than what is left; paying the rest settles it
    const over = await call("POST", `/debts/${id}/payments`, u.token, { accountId: acc, amount: "300001" });
    expect(over.status).toBe(400);
    expect((await call("POST", `/debts/${id}/payments`, u.token, { accountId: acc, amount: "300000" })).status).toBe(201);
    expect((await call("GET", `/debts/${id}`, u.token)).json.debt).toMatchObject({ remaining: "0", status: "settled", progress: 100 });
    expect((await call("POST", `/debts/${id}/payments`, u.token, { accountId: acc, amount: "1" })).status).toBe(400);
    expect((await call("GET", "/dashboard", u.token)).json.debts.payable).toBe("0");

    await ledgerNetsToZero(u.workspaceId);
  });

  it("lending moves cash out and creates a receivable; collecting with interest records income", async () => {
    const u = await newUser();
    const acc = await bank(u.token);
    const id = (await call("POST", "/debts", u.token, { direction: "receivable", kind: "personal", counterparty: "Sari", principal: "400000", accountId: acc })).json.debt.id as string;
    expect(await balance(u.token, acc)).toBe("600000");
    expect(await netWorth(u.token)).toBe("1000000");
    expect((await call("GET", "/debts", u.token)).json.totals.receivable).toBe("400000");

    expect((await call("POST", `/debts/${id}/payments`, u.token, { accountId: acc, amount: "100000", interest: "5000" })).status).toBe(201);
    expect(await balance(u.token, acc)).toBe("705000");
    expect((await call("GET", `/debts/${id}`, u.token)).json.debt.remaining).toBe("300000");
    expect(await netWorth(u.token)).toBe("1005000");
    expect((await call("GET", "/dashboard/cashflow?months=1", u.token)).json.months[0].income).toBe("5000");
    await ledgerNetsToZero(u.workspaceId);
  });

  it("an existing debt without an account lowers net worth and touches no balance", async () => {
    const u = await newUser();
    const acc = await bank(u.token);
    const r = await call("POST", "/debts", u.token, { direction: "payable", kind: "mortgage", counterparty: "Bank KPR", principal: "300000" });
    expect(r.status).toBe(201);
    expect(await balance(u.token, acc)).toBe("1000000");
    expect(await netWorth(u.token)).toBe("700000");
    // repaying it takes money out of the chosen account
    await call("POST", `/debts/${r.json.debt.id}/payments`, u.token, { accountId: acc, amount: "100000" });
    expect(await balance(u.token, acc)).toBe("900000");
    expect(await netWorth(u.token)).toBe("700000");
    await ledgerNetsToZero(u.workspaceId);
  });

  it("voiding a payment restores the balance; voiding a debt with payments is refused", async () => {
    const u = await newUser();
    const acc = await bank(u.token);
    const id = (await call("POST", "/debts", u.token, { direction: "payable", counterparty: "Andi", principal: "100000", accountId: acc })).json.debt.id as string;
    const pay = (await call("POST", `/debts/${id}/payments`, u.token, { accountId: acc, amount: "40000" })).json.transaction.id as string;

    expect((await call("POST", `/debts/${id}/void`, u.token)).status).toBe(409);

    expect((await call("POST", `/transactions/${pay}/void`, u.token)).status).toBe(204);
    expect((await call("GET", `/debts/${id}`, u.token)).json.debt).toMatchObject({ remaining: "100000", paid: "0" });
    expect(await balance(u.token, acc)).toBe("1100000");

    expect((await call("POST", `/debts/${id}/void`, u.token)).status).toBe(204);
    expect(await balance(u.token, acc)).toBe("1000000");
    expect((await call("GET", "/debts", u.token)).json.debts).toHaveLength(0);
    expect((await call("GET", `/debts/${id}`, u.token)).status).toBe(404);
    expect((await call("GET", "/dashboard", u.token)).json.debts).toEqual({ payable: "0", receivable: "0" });
    await ledgerNetsToZero(u.workspaceId);
  });

  it("cannot void the opening transaction directly while payments exist", async () => {
    const u = await newUser();
    const acc = await bank(u.token);
    const id = (await call("POST", "/debts", u.token, { direction: "receivable", counterparty: "Tono", principal: "100000", accountId: acc })).json.debt.id as string;
    await call("POST", `/debts/${id}/payments`, u.token, { accountId: acc, amount: "30000" });
    const txs = (await call("GET", "/transactions", u.token)).json.transactions as Json[];
    const opening = txs.find((t) => t.type === "lend")!;
    expect(opening.debt).toMatchObject({ counterparty: "Tono", direction: "receivable" });
    expect((await call("POST", `/transactions/${opening.id}/void`, u.token)).status).toBe(409);
  });

  it("is idempotent, validates input and isolates workspaces", async () => {
    const u = await newUser();
    const other = await newUser();
    const acc = await bank(u.token);
    const body = { direction: "payable", counterparty: "Rina", principal: "50000", accountId: acc, idempotencyKey: "debt-key-0001" };
    const a = await call("POST", "/debts", u.token, body);
    const b = await call("POST", "/debts", u.token, body);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.json.debt.id).toBe(a.json.debt.id);
    expect(b.json.replayed).toBe(true);
    expect(await balance(u.token, acc)).toBe("1050000");

    expect((await call("POST", "/debts", u.token, { direction: "payable", counterparty: "", principal: "1" })).status).toBe(400);
    expect((await call("POST", "/debts", u.token, { direction: "payable", counterparty: "X", principal: "0" })).status).toBe(400);
    expect((await call("POST", "/debts", u.token, { direction: "payable", counterparty: "X", principal: "5", dueDate: "31-12-2027" })).status).toBe(400);

    // another user can neither see, pay, edit nor void it, nor use my account
    const id = a.json.debt.id as string;
    expect((await call("GET", `/debts/${id}`, other.token)).status).toBe(404);
    expect((await call("GET", "/debts", other.token)).json.debts).toHaveLength(0);
    const theirs = await bank(other.token);
    expect((await call("POST", `/debts/${id}/payments`, other.token, { accountId: theirs, amount: "1000" })).status).toBe(404);
    expect((await call("PATCH", `/debts/${id}`, other.token, { counterparty: "Hack" })).status).toBe(404);
    expect((await call("POST", `/debts/${id}/void`, other.token)).status).toBe(404);
    expect((await call("POST", `/debts/${id}/payments`, u.token, { accountId: theirs, amount: "1000" })).status).toBe(404);
    expect((await call("POST", "/debts", other.token, { direction: "payable", counterparty: "Z", principal: "1000", accountId: acc })).status).toBe(404);
    expect((await call("GET", "/debts", null)).status).toBe(401);
  });

  it("edits the descriptive fields only", async () => {
    const u = await newUser();
    const id = (await call("POST", "/debts", u.token, { direction: "payable", counterparty: "Lia", principal: "10000" })).json.debt.id as string;
    expect((await call("PATCH", `/debts/${id}`, u.token, { counterparty: "Lia S.", dueDate: "2027-03-01", note: "cicilan", kind: "installment" })).status).toBe(204);
    expect((await call("GET", `/debts/${id}`, u.token)).json.debt).toMatchObject({ counterparty: "Lia S.", dueDate: "2027-03-01", note: "cicilan", kind: "installment", principal: "10000" });
    expect((await call("PATCH", `/debts/${id}`, u.token, { dueDate: null })).status).toBe(204);
    expect((await call("GET", `/debts/${id}`, u.token)).json.debt.dueDate).toBeNull();
    expect((await call("PATCH", `/debts/${id}`, u.token, {})).status).toBe(400);
  });

  it("serialises concurrent payments so the total can never exceed the remaining amount", async () => {
    const u = await newUser();
    const acc = await bank(u.token);
    const id = (await call("POST", "/debts", u.token, { direction: "payable", counterparty: "Race", principal: "100000", accountId: acc })).json.debt.id as string;
    const res = await Promise.all([1, 2, 3].map(() => call("POST", `/debts/${id}/payments`, u.token, { accountId: acc, amount: "60000" })));
    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    expect((await call("GET", `/debts/${id}`, u.token)).json.debt.remaining).toBe("40000");
    await ledgerNetsToZero(u.workspaceId);
  });
});
