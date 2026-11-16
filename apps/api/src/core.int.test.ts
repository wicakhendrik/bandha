import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ledgerEntries, seedAssets } from "@bandha/db";
import { assetIds, call, db, newUser, pool, type Json } from "./test-utils";

let IDR = "";
let BTC = "";
const balanceOf = async (token: string, accountId: string, symbol = "IDR") => {
  const list = (await call("GET", "/accounts", token)).json.accounts as Json[];
  return list.find((a) => a.id === accountId)?.balances.find((b: Json) => b.symbol === symbol)?.quantity ?? "0";
};

beforeAll(async () => {
  await seedAssets(db);
  const ids = await assetIds((await newUser()).token);
  IDR = ids["IDR"]!;
  BTC = ids["BTC"]!;
});
afterAll(async () => { await pool.end(); });

describe("accounts & transactions", () => {
  it("rejects unauthenticated access", async () => {
    expect((await call("GET", "/accounts", null)).status).toBe(401);
    expect((await call("GET", "/transactions", "bad-token")).status).toBe(401);
  });

  it("derives balances from the ledger through income, expense, transfer and void", async () => {
    const u = await newUser();
    const bca = (await call("POST", "/accounts", u.token, { name: "BCA", kind: "bank", openingBalance: { assetId: IDR, quantity: "1000000" } })).json.account.id;
    const dompet = (await call("POST", "/accounts", u.token, { name: "GoPay", kind: "ewallet", openingBalance: { assetId: IDR, quantity: "0" } })).json.account.id;
    expect(await balanceOf(u.token, bca)).toBe("1000000");
    expect(await balanceOf(u.token, dompet)).toBe("0");

    const exp = await call("POST", "/transactions", u.token, { type: "expense", accountId: bca, assetId: IDR, quantity: "86000", category: "Makan" });
    expect(exp.status).toBe(201);
    expect(await balanceOf(u.token, bca)).toBe("914000");

    await call("POST", "/transactions", u.token, { type: "income", accountId: bca, assetId: IDR, quantity: "500000" });
    expect(await balanceOf(u.token, bca)).toBe("1414000");

    expect((await call("POST", "/transactions", u.token, { type: "transfer", fromAccountId: bca, toAccountId: dompet, assetId: IDR, quantity: "200000" })).status).toBe(201);
    expect(await balanceOf(u.token, bca)).toBe("1214000");
    expect(await balanceOf(u.token, dompet)).toBe("200000");

    // void = reversal journal; balance restored, audit trail kept, hidden from the list
    const expId = exp.json.transaction.id as string;
    expect((await call("POST", `/transactions/${expId}/void`, u.token)).status).toBe(204);
    expect(await balanceOf(u.token, bca)).toBe("1300000");
    expect((await call("POST", `/transactions/${expId}/void`, u.token)).status).toBe(409);
    const list = (await call("GET", "/transactions", u.token)).json.transactions as Json[];
    expect(list.some((t) => t.id === expId)).toBe(false);
    // opening BCA + income + transfer; the voided expense is hidden and the zero opening balance posts nothing
    expect(list.map((t) => t.type).sort()).toEqual(["income", "opening", "transfer"]);

    // whole ledger always nets to zero in functional currency
    const [sum] = await db.select({ s: sql<string>`sum(${ledgerEntries.functionalAmount})` }).from(ledgerEntries).where(eq(ledgerEntries.workspaceId, u.workspaceId));
    expect(Number(sum?.s)).toBe(0);
  });

  it("is idempotent for a repeated key", async () => {
    const u = await newUser();
    const acc = (await call("POST", "/accounts", u.token, { name: "Kas", kind: "cash" })).json.account.id;
    const body = { type: "income", accountId: acc, assetId: IDR, quantity: "1000", idempotencyKey: `key-${randomUUID()}` };
    const a = await call("POST", "/transactions", u.token, body);
    const b = await call("POST", "/transactions", u.token, body);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.json.replayed).toBe(true);
    expect(b.json.transaction.id).toBe(a.json.transaction.id);
    expect(await balanceOf(u.token, acc)).toBe("1000");
  });

  it("requires a functional-currency value for non-IDR assets", async () => {
    const u = await newUser();
    const acc = (await call("POST", "/accounts", u.token, { name: "Wallet", kind: "exchange" })).json.account.id;
    const bad = await call("POST", "/transactions", u.token, { type: "income", accountId: acc, assetId: BTC, quantity: "0.5" });
    expect(bad.status).toBe(400);
    const ok = await call("POST", "/transactions", u.token, { type: "income", accountId: acc, assetId: BTC, quantity: "0.5", functionalAmount: "500000000" });
    expect(ok.status).toBe(201);
    expect(await balanceOf(u.token, acc, "BTC")).toBe("0.5");
  });

  it("validates input and uses safe metadata edits only", async () => {
    const u = await newUser();
    const acc = (await call("POST", "/accounts", u.token, { name: "Kas", kind: "cash" })).json.account.id;
    expect((await call("POST", "/transactions", u.token, { type: "income", accountId: acc, assetId: IDR, quantity: "0" })).status).toBe(400);
    expect((await call("POST", "/transactions", u.token, { type: "income", accountId: acc, assetId: IDR, quantity: "-5" })).status).toBe(400);
    expect((await call("POST", "/transactions", u.token, { type: "transfer", fromAccountId: acc, toAccountId: acc, assetId: IDR, quantity: "5" })).status).toBe(400);
    const t = (await call("POST", "/transactions", u.token, { type: "income", accountId: acc, assetId: IDR, quantity: "5000" })).json.transaction.id;
    expect((await call("PATCH", `/transactions/${t}`, u.token, { category: "Gaji", quantity: "999999" })).status).toBe(204);
    expect(await balanceOf(u.token, acc)).toBe("5000"); // amount cannot be edited
    const row = ((await call("GET", "/transactions", u.token)).json.transactions as Json[]).find((x) => x.id === t)!;
    expect(row.category).toBe("Gaji");
  });

  it("isolates data between users", async () => {
    const a = await newUser();
    const b = await newUser();
    const accA = (await call("POST", "/accounts", a.token, { name: "A", kind: "bank" })).json.account.id;
    const txA = (await call("POST", "/transactions", a.token, { type: "income", accountId: accA, assetId: IDR, quantity: "100" })).json.transaction.id;

    expect(((await call("GET", "/accounts", b.token)).json.accounts as Json[]).length).toBe(0);
    expect((await call("POST", "/transactions", b.token, { type: "income", accountId: accA, assetId: IDR, quantity: "100" })).status).toBe(404);
    expect((await call("POST", `/transactions/${txA}/void`, b.token)).status).toBe(404);
    expect((await call("PATCH", `/accounts/${accA}`, b.token, { name: "hack" })).status).toBe(404);
    expect((await call("POST", `/accounts/${accA}/archive`, b.token)).status).toBe(404);
    expect(await balanceOf(a.token, accA)).toBe("100");
  });

  it("archived accounts disappear but cannot receive transactions", async () => {
    const u = await newUser();
    const acc = (await call("POST", "/accounts", u.token, { name: "Lama", kind: "cash" })).json.account.id;
    expect((await call("POST", `/accounts/${acc}/archive`, u.token)).status).toBe(204);
    expect(((await call("GET", "/accounts", u.token)).json.accounts as Json[]).length).toBe(0);
    expect((await call("POST", "/transactions", u.token, { type: "income", accountId: acc, assetId: IDR, quantity: "1" })).status).toBe(404);
  });
});
