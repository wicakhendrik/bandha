import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedAssets } from "@bandha/db";
import { assetIds, call, db, newUser, pool } from "./test-utils";

let IDR = "";
beforeAll(async () => {
  await seedAssets(db);
  IDR = (await assetIds((await newUser()).token))["IDR"]!;
});
afterAll(async () => { await pool.end(); });

const status = async (token: string) => (await call("GET", "/onboarding", token)).json;

describe("getting started", () => {
  it("is derived from what the person has done, step by step", async () => {
    const u = await newUser();
    expect(await status(u.token)).toEqual({ accounts: 0, transactions: 0, dismissed: false, complete: false, show: true });

    // an account with an opening balance is the first step; the opening itself is not a transaction
    const acc = (await call("POST", "/accounts", u.token, { name: "BCA", kind: "bank", openingBalance: { assetId: IDR, quantity: "1000000" } })).json.account.id as string;
    expect(await status(u.token)).toMatchObject({ accounts: 1, transactions: 0, complete: false, show: true });

    // the first real transaction completes it, and the guide goes away on its own
    await call("POST", "/transactions", u.token, { type: "expense", accountId: acc, assetId: IDR, quantity: "25000" });
    expect(await status(u.token)).toEqual({ accounts: 1, transactions: 1, dismissed: false, complete: true, show: false });
  });

  it("does not count voided transactions or archived accounts", async () => {
    const u = await newUser();
    const acc = (await call("POST", "/accounts", u.token, { name: "BCA", kind: "bank" })).json.account.id as string;
    const tx = (await call("POST", "/transactions", u.token, { type: "income", accountId: acc, assetId: IDR, quantity: "1000" })).json.transaction.id as string;
    expect((await status(u.token)).complete).toBe(true);
    await call("POST", `/transactions/${tx}/void`, u.token);
    expect(await status(u.token)).toMatchObject({ transactions: 0, complete: false, show: true });
    await call("POST", `/accounts/${acc}/archive`, u.token);
    expect(await status(u.token)).toMatchObject({ accounts: 0, show: true });
  });

  it("an imported statement counts as the first transaction", async () => {
    const u = await newUser();
    const acc = (await call("POST", "/accounts", u.token, { name: "BCA", kind: "bank" })).json.account.id as string;
    await call("POST", "/imports", u.token, { accountId: acc, batchKey: `onb-${Date.now()}-abcdef`, rows: [{ day: "2026-11-01", description: "x", type: "expense", amount: "5000" }] });
    expect((await status(u.token)).complete).toBe(true);
  });

  it("can be dismissed, once, and stays dismissed", async () => {
    const u = await newUser();
    expect((await call("POST", "/onboarding/dismiss", u.token)).status).toBe(204);
    expect((await call("POST", "/onboarding/dismiss", u.token)).status).toBe(204);
    expect(await status(u.token)).toEqual({ accounts: 0, transactions: 0, dismissed: true, complete: false, show: false });
  });

  it("belongs to one person: another account's data and dismissal never leak", async () => {
    const a = await newUser();
    const b = await newUser();
    const acc = (await call("POST", "/accounts", a.token, { name: "BCA", kind: "bank" })).json.account.id as string;
    await call("POST", "/transactions", a.token, { type: "income", accountId: acc, assetId: IDR, quantity: "1000" });
    await call("POST", "/onboarding/dismiss", a.token);
    expect(await status(b.token)).toEqual({ accounts: 0, transactions: 0, dismissed: false, complete: false, show: true });
    expect((await call("GET", "/onboarding", null)).status).toBe(401);
    expect((await call("POST", "/onboarding/dismiss", null)).status).toBe(401);
  });
});
