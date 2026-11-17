import { describe, expect, it } from "vitest";
import { assetGroup, availableQty, decimalsOf, share } from "./txform";
import type { EditableTx } from "./types";

const accounts = [
  { id: "a1", balances: [{ assetId: "idr", symbol: "IDR", quantity: "1000000" }, { assetId: "usdt", symbol: "USDT", quantity: "812.5" }, { assetId: "btc", symbol: "BTC", quantity: "0.01300000" }] },
  { id: "a2", balances: [] },
];
const base: EditableTx = { id: "t", type: "expense", occurredAt: "2026-11-17T05:00:00Z", assetId: "idr", quantity: "0" };

describe("share", () => {
  it("rounds down to the decimals and never exceeds the balance", () => {
    expect(share("1000001", 25, 0)).toBe("250000");
    expect(share("0.013", 50, 8)).toBe("0.0065");
    expect(share("812.5", 75, 8)).toBe("609.375");
    expect(share("10", 33, 0)).toBe("3");
  });
  it("100% is the exact balance", () => {
    expect(share("0.01300000", 100, 8)).toBe("0.013");
    expect(share("812.5", 100, 0)).toBe("812.5");
  });
});

describe("decimalsOf", () => {
  it("is 0 for rupiah, capped at 8 otherwise", () => {
    expect(decimalsOf({ symbol: "IDR", decimals: 2 })).toBe(0);
    expect(decimalsOf({ symbol: "ETH", decimals: 18 })).toBe(8);
    expect(decimalsOf({ symbol: "BBCA", decimals: 0 })).toBe(0);
    expect(decimalsOf(undefined)).toBe(0);
  });
});

describe("availableQty", () => {
  it("is the account balance, or 0 for an asset it does not hold", () => {
    expect(availableQty(accounts, undefined, "idr", "a1", "usdt")).toBe("812.5");
    expect(availableQty(accounts, undefined, "idr", "a1", "sol")).toBe("0");
    expect(availableQty(accounts, undefined, "idr", "a2", "idr")).toBe("0");
  });
  it("adds back what an edited expense, sell or transfer took", () => {
    const exp = { ...base, accountId: "a1", assetId: "usdt", quantity: "100" };
    expect(availableQty(accounts, exp, "idr", "a1", "usdt")).toBe("912.5");
    expect(availableQty(accounts, exp, "idr", "a2", "usdt")).toBe("0");
    const tr: EditableTx = { ...base, type: "transfer", fromAccountId: "a1", assetId: "btc", quantity: "0.002" };
    expect(availableQty(accounts, tr, "idr", "a1", "btc")).toBe("0.015");
  });
  it("adds back the payment and fee of an edited buy, in the asset it paid with", () => {
    const buy: EditableTx = { ...base, type: "buy", fundingAccountId: "a1", assetId: "btc", quantity: "0.01", payAssetId: "usdt", payQuantity: "187.5", fee: "0.5", totalCost: "3000000" };
    expect(availableQty(accounts, buy, "idr", "a1", "usdt")).toBe("1000.5");
    expect(availableQty(accounts, buy, "idr", "a1", "idr")).toBe("1000000");
  });
  it("adds back the rupiah cost of an edited rupiah-funded buy", () => {
    const buy: EditableTx = { ...base, type: "buy", fundingAccountId: "a1", assetId: "btc", quantity: "0.01", totalCost: "500000", fee: "1000" };
    expect(availableQty(accounts, buy, "idr", "a1", "idr")).toBe("1501000");
  });
});

describe("assetGroup", () => {
  it("splits Indonesian and US shares by the .JK suffix", () => {
    expect(assetGroup({ kind: "stock", symbol: "BBCA", providerRef: "BBCA.JK" })).toBe("stockId");
    expect(assetGroup({ kind: "stock", symbol: "AAPL", providerRef: "AAPL" })).toBe("stockUs");
    expect(assetGroup({ kind: "stock", symbol: "X", providerRef: null })).toBe("stockUs");
  });
  it("groups the other kinds", () => {
    expect(assetGroup({ kind: "fiat", symbol: "USD" })).toBe("fiat");
    expect(assetGroup({ kind: "gold", symbol: "XAU" })).toBe("gold");
    expect(assetGroup({ kind: "crypto", symbol: "BTC" })).toBe("mainCoins");
    expect(assetGroup({ kind: "crypto", symbol: "PEPE" })).toBe("otherCoins");
  });
});
