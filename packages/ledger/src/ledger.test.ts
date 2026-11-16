import { describe, expect, it } from "vitest";
import {
  assertBalanced, balanceOf, buildExpense, buildIncome, buildOpeningBalance, buildTransfer,
  reverseEntries, UnbalancedJournalError, applyBuy, applySell, applyTransfer, unrealizedPnl, dec,
  type Position,
} from "./index";

const IDR = "asset-idr";
const cash = (accountId: string, q: string) => ({ accountId, assetId: IDR, quantity: q, functionalAmount: q });

describe("journal", () => {
  it("rejects unbalanced journals", () => {
    expect(() =>
      assertBalanced([
        { accountId: "a", assetId: IDR, quantity: "100", functionalAmount: "100" },
        { accountId: "b", assetId: IDR, quantity: "-99", functionalAmount: "-99" },
      ]),
    ).toThrow(UnbalancedJournalError);
  });

  it("rejects zero-quantity entries", () => {
    expect(() =>
      assertBalanced([
        { accountId: "a", assetId: IDR, quantity: "0", functionalAmount: "0" },
        { accountId: "b", assetId: IDR, quantity: "0", functionalAmount: "0" },
      ]),
    ).toThrow(/Zero-quantity/);
  });

  it("uses exact decimal arithmetic (0.1 + 0.2 === 0.3)", () => {
    expect(dec("0.1").plus(dec("0.2")).toFixed()).toBe("0.3");
  });

  it("refuses numbers to avoid floating point", () => {
    expect(() => dec(0.1 as unknown as string)).toThrow();
  });

  it("void = reversal nets every account balance to zero", () => {
    const j = buildExpense({ cash: cash("bca", "86000"), expenseAccountId: "exp", expenseAssetId: IDR });
    const all = [...j, ...reverseEntries(j)];
    expect(balanceOf(all, "bca", IDR)).toBe("0");
    expect(balanceOf(all, "exp", IDR)).toBe("0");
  });
});

describe("builders", () => {
  it("income raises the account and credits the income account", () => {
    const j = buildIncome({ cash: cash("bca", "28500000"), incomeAccountId: "inc", incomeAssetId: IDR });
    expect(balanceOf(j, "bca", IDR)).toBe("28500000");
    expect(balanceOf(j, "inc", IDR)).toBe("-28500000");
  });

  it("zero opening balance creates no entries", () => {
    expect(buildOpeningBalance({ account: cash("bca", "0"), equityAccountId: "eq", equityAssetId: IDR })).toEqual([]);
  });

  it("transfer is not income or expense and nets to zero", () => {
    const j = buildTransfer({ fromAccountId: "bca", toAccountId: "gopay", assetId: IDR, quantity: "500000", functionalAmount: "500000" });
    expect(balanceOf(j, "bca", IDR)).toBe("-500000");
    expect(balanceOf(j, "gopay", IDR)).toBe("500000");
  });

  it("rejects transfer to same account", () => {
    expect(() => buildTransfer({ fromAccountId: "a", toAccountId: "a", assetId: IDR, quantity: "1", functionalAmount: "1" })).toThrow();
  });
});

describe("weighted-average position", () => {
  it("averages cost across buys", () => {
    let p: Position = { quantity: "0", costBasis: "0" };
    p = applyBuy(p, "1", "100").position;
    p = applyBuy(p, "1", "200").position;
    expect(p).toEqual({ quantity: "2", costBasis: "300" });
  });

  it("sell realises P/L against average cost", () => {
    const r = applySell({ quantity: "2", costBasis: "300" }, "1", "200");
    expect(r.realizedPnl).toBe("50");
    expect(r.position).toEqual({ quantity: "1", costBasis: "150" });
  });

  it("unknown cost basis stays unknown, never zero", () => {
    const r = applySell({ quantity: "2", costBasis: null }, "1", "200");
    expect(r.realizedPnl).toBeNull();
    expect(r.position.costBasis).toBeNull();
    expect(unrealizedPnl({ quantity: "1", costBasis: null }, "10").pnl).toBeNull();
  });

  it("transfer preserves total cost basis and realises nothing", () => {
    const r = applyTransfer({ quantity: "4", costBasis: "400" }, { quantity: "0", costBasis: "0" }, "1");
    expect(r.from).toEqual({ quantity: "3", costBasis: "300" });
    expect(r.to).toEqual({ quantity: "1", costBasis: "100" });
    expect(dec(r.from.costBasis as string).plus(dec(r.to.costBasis as string)).toFixed()).toBe("400");
  });

  it("cannot oversell", () => {
    expect(() => applySell({ quantity: "1", costBasis: "10" }, "2", "5")).toThrow();
  });

  it("market value uses the functional-currency price", () => {
    expect(unrealizedPnl({ quantity: "2", costBasis: "300" }, "200")).toEqual({ marketValue: "400", pnl: "100" });
  });
});
