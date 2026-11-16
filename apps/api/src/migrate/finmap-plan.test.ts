import { describe, expect, it } from "vitest";
import { accountKind, accountName, buildPlan } from "./finmap-plan";
import type { FmData } from "./finmap-source";

describe("account naming and kind", () => {
  it("joins source and account without repeating the institution", () => {
    expect(accountName("BCA", "Tabungan")).toBe("BCA Tabungan");
    expect(accountName("BCA", "BCA Utama")).toBe("BCA Utama");
    expect(accountName("GoPay", "GoPay")).toBe("GoPay");
    expect(accountName("Bank Mandiri", "Mandiri")).toBe("Bank Mandiri");
    expect(accountName("", "Dompet")).toBe("Dompet");
    expect(accountName("x".repeat(60), "y".repeat(60))).toHaveLength(80);
  });
  it("maps FinMap account types to Bandha kinds", () => {
    expect(accountKind("bank", "savings", "fiat")).toBe("bank");
    expect(accountKind("bank", "checking", null)).toBe("bank");
    expect(accountKind("exchange", "exchange", "crypto")).toBe("exchange");
    expect(accountKind("wallet", "wallet", "fiat")).toBe("ewallet");
    expect(accountKind("wallet", "wallet", "crypto")).toBe("wallet");
    expect(accountKind("brokerage", "brokerage", null)).toBe("brokerage");
    expect(accountKind("bank", "credit", "fiat")).toBe("other");
    expect(accountKind("exchange", "other", null)).toBe("exchange");
    expect(accountKind("whatever", "other", null)).toBe("other");
  });
});

const D = (s: string) => new Date(s);
const data = (over: Partial<FmData> = {}): FmData => ({
  owner: { id: "u", email: "A@B.CO", passwordHash: "$argon2id$x" },
  workspace: { id: "w", name: "WS", currencyCode: "IDR" },
  otherMembers: 0,
  assets: [
    { id: "idr", type: "fiat", symbol: "IDR", name: "Rupiah", decimals: 0, fiatCurrencyCode: "IDR", coingeckoId: null },
    { id: "usd", type: "fiat", symbol: "USD", name: "Dollar", decimals: 2, fiatCurrencyCode: "USD", coingeckoId: null },
    { id: "btc", type: "crypto", symbol: "BTC", name: "Bitcoin", decimals: 8, fiatCurrencyCode: null, coingeckoId: "bitcoin" },
    { id: "eth", type: "crypto", symbol: "ETH", name: "Ether", decimals: 8, fiatCurrencyCode: null, coingeckoId: "ethereum" },
    { id: "xau", type: "commodity", symbol: "XAU", name: "Gold", decimals: 2, fiatCurrencyCode: null, coingeckoId: null },
  ],
  sources: [{ id: "s1", type: "exchange", name: "Indodax", archivedAt: null }, { id: "s2", type: "bank", name: "BCA", archivedAt: null }],
  accounts: [
    { id: "ex", financialSourceId: "s1", name: "Indodax", accountType: "exchange", defaultAssetId: "btc", includeInNetWorth: true, openedAt: D("2026-01-01T00:00:00Z"), archivedAt: null },
    { id: "bk", financialSourceId: "s2", name: "Tabungan", accountType: "savings", defaultAssetId: "idr", includeInNetWorth: true, openedAt: D("2026-01-01T00:00:00Z"), archivedAt: null },
  ],
  transactions: [], notPosted: {}, ledgerAccounts: [], entries: [], debts: [], balances: [],
  ...over,
});
const tx = (type: string, snapshot: Record<string, unknown>, at = "2026-02-01T00:00:00Z") => ({
  id: `t-${type}-${at}`, transactionType: type, status: "posted", category: null, description: null, occurredAt: D(at), createdAt: D(at), snapshot, journalId: null,
});
const conv = (over: Record<string, unknown>) => ({
  transactionType: "conversion", sourceAccountId: "bk", sourceAssetId: "idr", sourceQuantity: "1000", sourceFunctionalAmount: "1000",
  destinationAccountId: "ex", destinationAssetId: "btc", destinationQuantity: "0.5", destinationFunctionalAmount: "1000", ...over,
});

describe("conversions", () => {
  it("rupiah for something else is a buy, something else for rupiah is a sell", () => {
    const p = buildPlan(data({ transactions: [
      tx("conversion", conv({})),
      tx("conversion", conv({ sourceAccountId: "ex", sourceAssetId: "btc", sourceQuantity: "0.1", destinationAccountId: "bk", destinationAssetId: "idr", destinationQuantity: "700" }), "2026-02-02T00:00:00Z"),
    ] }));
    expect(p.steps).toMatchObject([
      { k: "buy", account: "ex", funding: "bk", asset: "btc", quantity: "0.5", totalCost: "1000" },
      { k: "sell", account: "ex", receiving: "bk", asset: "btc", quantity: "0.1", proceeds: "700" },
    ]);
  });

  it("a swap between two non-rupiah assets sells and buys at the same rupiah value, leaving no rupiah behind", () => {
    const p = buildPlan(data({ transactions: [tx("conversion", conv({ sourceAccountId: "ex", sourceAssetId: "btc", sourceQuantity: "0.1", sourceFunctionalAmount: "5000", destinationAccountId: "ex", destinationAssetId: "eth", destinationQuantity: "2", destinationFunctionalAmount: "4900" }))] }));
    expect(p.steps).toMatchObject([
      { k: "sell", asset: "btc", quantity: "0.1", proceeds: "4900" },
      { k: "buy", asset: "eth", quantity: "2", totalCost: "4900" },
    ]);
  });

  it("the same asset on both sides is just a transfer", () => {
    const p = buildPlan(data({ transactions: [tx("conversion", conv({ destinationAssetId: "idr", destinationQuantity: "1000" }))] }));
    expect(p.steps).toMatchObject([{ k: "transfer", from: "bk", to: "ex", asset: "idr", quantity: "1000" }]);
  });

  it("a fee becomes its own expense only when FinMap says which asset paid it", () => {
    const withAsset = buildPlan(data({ transactions: [tx("conversion", conv({ feeQuantity: "50", feeFunctionalAmount: "50", feeAssetId: "idr" }))] }));
    expect(withAsset.steps.map((s) => s.k)).toEqual(["buy", "expense"]);
    expect(withAsset.steps[1]).toMatchObject({ account: "bk", asset: "idr", quantity: "50", category: "Biaya konversi" });
    const without = buildPlan(data({ transactions: [tx("conversion", conv({ feeQuantity: "50", feeFunctionalAmount: "50" }))] }));
    expect(without.steps.map((s) => s.k)).toEqual(["buy"]);
    expect(without.warnings.some((w) => w.includes("tidak punya aset"))).toBe(true);
  });
});

describe("the rest of the plan", () => {
  it("puts openings first, whatever their date", () => {
    const p = buildPlan(data({ transactions: [
      tx("income", { transactionType: "income", accountId: "bk", assetId: "idr", quantity: "5", functionalAmount: "5" }, "2025-12-01T00:00:00Z"),
      tx("opening_balance", { transactionType: "opening_balance", accountId: "bk", items: [{ assetId: "idr", quantity: "100" }] }, "2026-01-05T00:00:00Z"),
    ] }));
    expect(p.steps.map((s) => s.k)).toEqual(["opening", "income"]);
  });

  it("a foreign-currency opening is re-estimated (FinMap booked it at face value in rupiah); a crypto opening keeps its unit cost", () => {
    const p = buildPlan(data({ transactions: [tx("opening_balance", { transactionType: "opening_balance", accountId: "ex", items: [
      { assetId: "usd", quantity: "100", costBasisFunctional: "100" }, { assetId: "btc", quantity: "0.5", costBasisFunctional: "500000000" }, { assetId: "eth", quantity: "1" },
    ] })] }));
    expect(p.steps).toMatchObject([{ asset: "usd", unitCost: null }, { asset: "btc", unitCost: "500000000" }, { asset: "eth", unitCost: null }]);
  });

  it("skips what it cannot place, with a reason, and counts what never touched balances", () => {
    const p = buildPlan(data({
      transactions: [tx("dividend", {}), tx("income", { transactionType: "income", accountId: "nope", assetId: "idr", quantity: "5", functionalAmount: "5" })],
      notPosted: { draft: 2, void: 1 },
    }));
    expect(p.steps).toEqual([]);
    expect(p.skipped).toHaveLength(2);
    expect(p.warnings.join(" ")).toContain('2 transaksi berstatus "draft"');
  });

  it("gold needs a unit before anything is migrated, and ounces become grams", () => {
    const d = data({ transactions: [tx("opening_balance", { transactionType: "opening_balance", accountId: "bk", items: [{ assetId: "xau", quantity: "2", costBasisFunctional: "60000000" }] })], balances: [{ accountId: "bk", assetId: "xau", quantity: "2" }] });
    expect(buildPlan(d).blockers[0]).toContain("--gold-unit");
    const gram = buildPlan(d, { goldUnit: "gram" });
    expect(gram.blockers).toEqual([]);
    expect(gram.steps[0]).toMatchObject({ quantity: "2" });
    const oz = buildPlan(d, { goldUnit: "ounce" });
    expect(oz.steps[0]).toMatchObject({ quantity: "62.2069536", unitCost: expect.any(String) });
    expect(oz.expected[0]).toMatchObject({ quantity: "62.2069536" });
    // the price per gram is the price per ounce divided by 31.1034768, so the total cost stays the same
    const s = oz.steps[0] as { quantity: string; unitCost: string };
    expect(Number(s.quantity) * Number(s.unitCost)).toBeCloseTo(2 * 60_000_000, 0);
  });

  it("only IDR workspaces can be migrated", () => {
    expect(buildPlan(data({ workspace: { id: "w", name: "WS", currencyCode: "USD" } })).blockers[0]).toContain("USD");
  });

  it("debts: remaining balance becomes the principal; settled ones are skipped", () => {
    const debt = (id: string, over: Record<string, unknown>) => ({ id, name: id, contractType: "mortgage", direction: "liability", principalAmount: "100", remainingBalance: "60", interestRate: "7.5", nextPaymentDate: D("2026-12-05T00:00:00Z"), maturityDate: null, status: "active", ...over });
    const p = buildPlan(data({ debts: [
      debt("KPR", {}), debt("Budi", { contractType: "receivable", direction: "receivable", interestRate: null, nextPaymentDate: null }),
      debt("Lunas", { status: "paid_off" }), debt("Nol", { remainingBalance: "0" }),
    ] }));
    expect(p.debts).toMatchObject([
      { counterparty: "KPR", direction: "payable", kind: "mortgage", principal: "60", dueDate: "2026-12-05" },
      { counterparty: "Budi", direction: "receivable", kind: "personal", principal: "60", dueDate: null },
    ]);
    expect(p.debts[0]!.note).toContain("Pokok awal Rp 100");
    expect(p.skipped.map((s) => s.reason)).toEqual(["status paid_off, tidak dimigrasi", "sisa nol"]);
  });

  it("warns about shared workspaces and accounts without a password, and lowercases the email", () => {
    const p = buildPlan(data({ otherMembers: 1, owner: { id: "u", email: "A@B.CO", passwordHash: null } }));
    expect(p.user).toMatchObject({ email: "a@b.co", name: "A", passwordHash: null });
    expect(p.warnings.join(" ")).toContain("2 orang");
    expect(p.warnings.join(" ")).toContain("Lupa kata sandi");
  });
});
