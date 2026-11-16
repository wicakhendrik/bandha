import { describe, expect, it } from "vitest";
import { applySell, balanceOf, buildBuy, buildSell, dec, roundMoney, sumFunctional, type Position } from "./index";

const IDR = "idr";
const BTC = "btc";

describe("buildBuy", () => {
  it("moves the asset in at cost and cash out, balanced", () => {
    const e = buildBuy({ assetAccountId: "ex", assetId: BTC, quantity: "0.01", cost: "9500000", cashAccountId: "bca", cashAssetId: IDR });
    expect(balanceOf(e, "ex", BTC)).toBe("0.01");
    expect(balanceOf(e, "bca", IDR)).toBe("-9500000");
    expect(sumFunctional(e)).toBe("0");
  });

  it("posts the fee as a separate expense, leaving the cost basis untouched", () => {
    const e = buildBuy({ assetAccountId: "ex", assetId: BTC, quantity: "0.01", cost: "9500000", cashAccountId: "bca", cashAssetId: IDR, fee: { amount: "25000", expenseAccountId: "exp" } });
    expect(e.find((x) => x.accountId === "ex")?.functionalAmount).toBe("9500000"); // basis excludes the fee
    expect(balanceOf(e, "bca", IDR)).toBe("-9525000");
    expect(balanceOf(e, "exp", IDR)).toBe("25000");
    expect(sumFunctional(e)).toBe("0");
  });

  it("works when the same account holds the cash and the asset", () => {
    const e = buildBuy({ assetAccountId: "ex", assetId: BTC, quantity: "1", cost: "100", cashAccountId: "ex", cashAssetId: IDR });
    expect(balanceOf(e, "ex", IDR)).toBe("-100");
    expect(balanceOf(e, "ex", BTC)).toBe("1");
  });

  it("rejects non-positive quantity or cost", () => {
    expect(() => buildBuy({ assetAccountId: "a", assetId: BTC, quantity: "0", cost: "1", cashAccountId: "b", cashAssetId: IDR })).toThrow();
    expect(() => buildBuy({ assetAccountId: "a", assetId: BTC, quantity: "1", cost: "0", cashAccountId: "b", cashAssetId: IDR })).toThrow();
  });
});

describe("buildSell", () => {
  const base = { assetAccountId: "ex", assetId: BTC, quantity: "0.5", cashAccountId: "bca", cashAssetId: IDR, pnlAccountId: "pnl" };

  it("a gain credits the P/L account and stays balanced", () => {
    const e = buildSell({ ...base, soldCost: "400", proceeds: "700" });
    expect(balanceOf(e, "ex", BTC)).toBe("-0.5");
    expect(balanceOf(e, "bca", IDR)).toBe("700");
    expect(balanceOf(e, "pnl", IDR)).toBe("-300"); // credit = gain
    expect(sumFunctional(e)).toBe("0");
  });

  it("a loss debits the P/L account", () => {
    const e = buildSell({ ...base, soldCost: "400", proceeds: "250" });
    expect(balanceOf(e, "pnl", IDR)).toBe("150"); // debit = loss
    expect(sumFunctional(e)).toBe("0");
  });

  it("break-even posts no P/L entry", () => {
    const e = buildSell({ ...base, soldCost: "400", proceeds: "400" });
    expect(e.some((x) => x.accountId === "pnl")).toBe(false);
    expect(sumFunctional(e)).toBe("0");
  });

  it("fee is a separate expense and does not change P/L", () => {
    const e = buildSell({ ...base, soldCost: "400", proceeds: "700", fee: { amount: "10", expenseAccountId: "exp" } });
    expect(balanceOf(e, "pnl", IDR)).toBe("-300");
    expect(balanceOf(e, "bca", IDR)).toBe("690");
    expect(balanceOf(e, "exp", IDR)).toBe("10");
    expect(sumFunctional(e)).toBe("0");
  });

  it("integrates with weighted-average: realised P/L matches the journal", () => {
    const pos: Position = { quantity: "2", costBasis: "300" };
    const sold = applySell(pos, "1", "200");
    const soldCost = roundMoney(dec(pos.costBasis as string).minus(dec(sold.position.costBasis as string)).toFixed());
    const e = buildSell({ ...base, quantity: "1", soldCost, proceeds: "200" });
    expect(balanceOf(e, "pnl", IDR)).toBe(dec(sold.realizedPnl as string).neg().toFixed());
  });
});

describe("roundMoney", () => {
  it("rounds to 8 decimals so database rounding cannot unbalance a journal", () => {
    expect(roundMoney("1.123456789")).toBe("1.12345679");
    expect(roundMoney("100")).toBe("100");
    // 1/3 of 100 would otherwise carry 40 digits
    expect(roundMoney(dec("100").div(3).toFixed())).toBe("33.33333333");
  });
});
