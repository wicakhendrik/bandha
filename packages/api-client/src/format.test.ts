import { describe, expect, it } from "vitest";
import { dateLong, dateShort, greeting, initials, isAmount, isAmountOrZero, isDateKey, monthLabel, pct, qty, rp, signedRp, todayKey } from "./format";
import { balanceText, ledgerRowView, txView } from "./txview";
import type { Account, Asset, LedgerRow, Tx } from "./types";

describe("format", () => {
  it("rp groups thousands with dots and rounds to whole rupiah", () => {
    expect(rp("1284560000")).toBe("Rp 1.284.560.000");
    expect(rp("0")).toBe("Rp 0");
    expect(rp("86000.6")).toBe("Rp 86.001");
    expect(rp("-1240000")).toBe("−Rp 1.240.000");
    expect(rp("-0.2")).toBe("Rp 0");
    expect(rp(null)).toBe("—");
    expect(rp("abc")).toBe("—");
  });

  it("qty trims trailing zeros and uses a decimal comma", () => {
    expect(qty("0.5")).toBe("0,5");
    expect(qty("0.01000000")).toBe("0,01");
    expect(qty("250")).toBe("250");
    expect(qty("1234567.891")).toBe("1.234.567,891");
    expect(qty("0.00000001")).toBe("0,00000001");
  });

  it("dates are computed in Asia/Jakarta, not the device timezone", () => {
    expect(dateShort("2026-11-15T20:00:00Z")).toBe("16 Nov"); // 03:00 WIB next day
    expect(dateShort("2026-11-15T16:59:00Z")).toBe("15 Nov");
    expect(dateLong(new Date("2026-11-15T05:00:00Z"))).toBe("Minggu, 15 November 2026");
    expect(todayKey(new Date("2026-11-15T20:00:00Z"))).toBe("2026-11-16");
    expect(monthLabel("2026-05")).toBe("Mei");
  });

  it("greets by Jakarta hour", () => {
    expect(greeting(new Date("2026-11-15T00:00:00Z"))).toBe("Sugeng enjang"); // 07:00
    expect(greeting(new Date("2026-11-15T14:00:00Z"))).toBe("Sugeng ndalu"); // 21:00
  });

  it("validates amounts and dates", () => {
    expect(isAmount("85000")).toBe(true);
    expect(isAmount("0")).toBe(false);
    expect(isAmount("0.0")).toBe(false);
    expect(isAmount("-5")).toBe(false);
    expect(isAmount("1,5")).toBe(false);
    expect(isAmountOrZero("0")).toBe(true);
    expect(isDateKey("2026-11-15")).toBe(true);
    expect(isDateKey("15-11-2026")).toBe(false);
    expect(isDateKey("2026-13-45")).toBe(false);
  });

  it("signedRp and pct always show the sign, with Indonesian separators", () => {
    expect(signedRp("5500000")).toBe("+Rp 5.500.000");
    expect(signedRp("-1000000")).toBe("−Rp 1.000.000");
    expect(signedRp("0")).toBe("Rp 0");
    expect(signedRp(null)).toBe("—");
    expect(pct("57.89")).toBe("+57,89%");
    expect(pct("-3.5")).toBe("−3,50%");
    expect(pct("0")).toBe("0,00%");
    expect(pct(null)).toBe("—");
  });

  it("initials", () => {
    expect(initials("Wicak Demo Satu")).toBe("WD");
    expect(initials("")).toBe("?");
  });
});

describe("txView", () => {
  const assets = new Map<string, Asset>([
    ["idr", { id: "idr", symbol: "IDR", name: "Rupiah", kind: "fiat", decimals: 2 }],
    ["btc", { id: "btc", symbol: "BTC", name: "Bitcoin", kind: "crypto", decimals: 8 }],
  ]);
  const acc = (id: string, name: string): Account => ({ id, name, kind: "bank", brandKey: null, includeInNetWorth: true, balances: [] });
  const accounts = new Map([["a", acc("a", "BCA")], ["b", acc("b", "GoPay")]]);
  const base = { status: "posted", occurredAt: "2026-11-15T05:00:00Z", description: null, category: null, tags: [] };

  it("expense shows a minus and the account", () => {
    const t: Tx = { ...base, id: "1", type: "expense", description: "Kopi", legs: [{ accountId: "a", assetId: "idr", quantity: "-85000", functionalAmount: "-85000" }] };
    expect(txView(t, accounts, assets)).toEqual({ title: "Kopi", accountLabel: "BCA", amount: "−Rp 85.000", secondary: null, tone: "neg" });
  });

  it("crypto income shows the quantity with its rupiah value", () => {
    const t: Tx = { ...base, id: "2", type: "income", legs: [{ accountId: "a", assetId: "btc", quantity: "0.01", functionalAmount: "9500000" }] };
    const v = txView(t, accounts, assets);
    expect(v.amount).toBe("+0,01 BTC");
    expect(v.secondary).toBe("Rp 9.500.000");
    expect(v.tone).toBe("pos");
  });

  it("transfer shows from → to with a neutral tone", () => {
    const t: Tx = { ...base, id: "3", type: "transfer", legs: [
      { accountId: "a", assetId: "idr", quantity: "-500000", functionalAmount: "-500000" },
      { accountId: "b", assetId: "idr", quantity: "500000", functionalAmount: "500000" },
    ] };
    expect(txView(t, accounts, assets)).toMatchObject({ accountLabel: "BCA → GoPay", amount: "Rp 500.000", tone: "" });
  });

  it("a buy shows the quantity with its IDR cost, a sell shows the proceeds", () => {
    const withBtc = new Map(assets).set("btc2", { id: "btc2", symbol: "BTC", name: "Bitcoin", kind: "crypto", decimals: 8 });
    const buy: Tx = { ...base, id: "4", type: "buy", legs: [
      { accountId: "b", assetId: "btc2", quantity: "0.01", functionalAmount: "9500000" },
      { accountId: "a", assetId: "idr", quantity: "-9500000", functionalAmount: "-9500000" },
    ] };
    expect(txView(buy, accounts, withBtc)).toEqual({ title: "Beli BTC", accountLabel: "BCA → GoPay", amount: "+0,01 BTC", secondary: "Rp 9.500.000", tone: "pos" });

    // asset leaves at COST (5.000.000); the sale brought in 8.000.000
    const sell: Tx = { ...base, id: "5", type: "sell", legs: [
      { accountId: "b", assetId: "btc2", quantity: "-0.005", functionalAmount: "-5000000" },
      { accountId: "a", assetId: "idr", quantity: "8000000", functionalAmount: "8000000" },
    ] };
    const v = txView(sell, accounts, withBtc);
    expect(v).toMatchObject({ title: "Jual BTC", amount: "−0,005 BTC", secondary: "Rp 8.000.000", tone: "neg" });
  });

  it("an asset-for-asset trade shows both sides: BTC bought with USDT, and BTC sold for USDT", () => {
    const pair = new Map(assets).set("usdt", { id: "usdt", symbol: "USDT", name: "Tether", kind: "crypto", decimals: 6 });
    const buy: Tx = { ...base, id: "6", type: "buy", legs: [
      { accountId: "a", assetId: "btc", quantity: "0.005", functionalAmount: "8100000" },
      { accountId: "a", assetId: "usdt", quantity: "-501", functionalAmount: "-7915800" },
    ] };
    expect(txView(buy, accounts, pair)).toEqual({ title: "Beli BTC", accountLabel: "BCA", amount: "+0,005 BTC", secondary: "Rp 8.100.000 · −501 USDT", tone: "pos" });

    const sell: Tx = { ...base, id: "7", type: "sell", legs: [
      { accountId: "a", assetId: "btc", quantity: "-0.004", functionalAmount: "-3800000" },
      { accountId: "b", assetId: "usdt", quantity: "599", functionalAmount: "9703800" },
    ] };
    expect(txView(sell, accounts, pair)).toEqual({ title: "Jual BTC", accountLabel: "BCA → GoPay", amount: "−0,004 BTC", secondary: "Rp 9.703.800 · +599 USDT", tone: "neg" });
  });

  it("balanceText joins assets and falls back to zero", () => {
    expect(balanceText({ ...acc("x", "X"), balances: [{ assetId: "btc", symbol: "BTC", quantity: "0.01" }, { assetId: "idr", symbol: "IDR", quantity: "1000" }] })).toBe("0,01 BTC · Rp 1.000");
    expect(balanceText(acc("x", "X"))).toBe("Rp 0");
  });
});

describe("ledgerRowView", () => {
  const row = (over: Partial<LedgerRow>): LedgerRow => ({
    transactionId: "t", type: "expense", occurredAt: "2026-11-15T05:00:00Z", description: null, category: null,
    assetId: "idr", symbol: "IDR", quantity: "-86000", functionalAmount: "-86000", balance: "10389000", ...over,
  });

  it("rupiah movement: signed amount, running balance, no secondary value", () => {
    expect(ledgerRowView(row({ description: "Kopi" }))).toEqual({
      title: "Kopi", typeLabel: "Pengeluaran", amount: "−Rp 86.000", secondary: null, balance: "Rp 10.389.000", tone: "neg",
    });
  });

  it("crypto movement: quantity with symbol, rupiah cost as secondary, balance in the asset", () => {
    const v = ledgerRowView(row({ type: "buy", assetId: "b", symbol: "BTC", quantity: "0.01", functionalAmount: "9500000", balance: "0.03" }));
    expect(v).toMatchObject({ title: "Beli", amount: "+0,01 BTC", secondary: "Rp 9.500.000", balance: "0,03 BTC", tone: "pos" });
  });

  it("falls back to category then type label for the title", () => {
    expect(ledgerRowView(row({ category: "Makan" })).title).toBe("Makan");
    expect(ledgerRowView(row({ type: "transfer" })).title).toBe("Transfer");
  });
});
