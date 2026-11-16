import { describe, expect, it } from "vitest";
import { allocate, pickPrice, valueHoldings, type HoldingInput, type PriceQuote } from "./index";

const now = new Date("2026-11-15T10:00:00Z");
const HOUR = 3_600_000;
const idr: HoldingInput = { assetId: "idr", symbol: "IDR", kind: "fiat", quantity: "1000000", isFunctional: true };
const usdt: HoldingInput = { assetId: "usdt", symbol: "USDT", kind: "crypto", quantity: "100", isFunctional: false };
const btc: HoldingInput = { assetId: "btc", symbol: "BTC", kind: "crypto", quantity: "0.5", isFunctional: false };

const q = (assetId: string, quoteSymbol: string, price: string, asOf = now): PriceQuote => ({ assetId, quoteSymbol, price, asOf });

describe("valuation", () => {
  it("a USD quote can never be read as an IDR quote (FinMap USDT/USDC bug)", () => {
    const onlyUsd = [q("usdt", "USD", "1")];
    expect(pickPrice(onlyUsd, "usdt", "IDR")).toBeNull();
    const v = valueHoldings([usdt], onlyUsd, "IDR", now, HOUR);
    expect(v.rows[0]?.value).toBeNull();
    expect(v.complete).toBe(false);
    expect(v.unpriced).toEqual(["USDT"]);
    expect(v.total).toBe("0");
  });

  it("with both quotes present the IDR one is used", () => {
    const quotes = [q("usdt", "USD", "1"), q("usdt", "IDR", "16200")];
    const v = valueHoldings([usdt], quotes, "IDR", now, HOUR);
    expect(v.rows[0]?.price).toBe("16200");
    expect(v.rows[0]?.value).toBe("1620000");
    expect(v.complete).toBe(true);
  });

  it("totals functional currency at 1:1 plus priced assets", () => {
    const v = valueHoldings([idr, btc], [q("btc", "IDR", "1500000000")], "IDR", now, HOUR);
    expect(v.total).toBe("751000000");
    expect(v.complete).toBe(true);
  });

  it("an unpriced holding is flagged, never counted as zero value", () => {
    const v = valueHoldings([idr, btc], [], "IDR", now, HOUR);
    expect(v.total).toBe("1000000");
    expect(v.complete).toBe(false);
    expect(v.unpriced).toEqual(["BTC"]);
  });

  it("a zero balance without a price does not make the total incomplete", () => {
    const v = valueHoldings([{ ...btc, quantity: "0" }], [], "IDR", now, HOUR);
    expect(v.complete).toBe(true);
  });

  it("marks quotes older than the threshold as stale", () => {
    const old = new Date(now.getTime() - 7 * HOUR);
    const v = valueHoldings([btc], [q("btc", "IDR", "100", old)], "IDR", now, 6 * HOUR);
    expect(v.rows[0]?.stale).toBe(true);
    expect(valueHoldings([btc], [q("btc", "IDR", "100")], "IDR", now, 6 * HOUR).rows[0]?.stale).toBe(false);
  });

  it("allocation percentages use positive values only and sort descending", () => {
    const a = allocate([
      { key: "fiat", value: "750" },
      { key: "crypto", value: "250" },
      { key: "debt", value: "-100" },
    ]);
    expect(a).toEqual([
      { key: "fiat", value: "750", percent: "75.0" },
      { key: "crypto", value: "250", percent: "25.0" },
    ]);
    expect(allocate([])).toEqual([]);
  });

  it("merges holdings of the same kind into one slice", () => {
    expect(allocate([
      { key: "crypto", value: "600" },
      { key: "crypto", value: "200" },
      { key: "fiat", value: "200" },
    ])).toEqual([
      { key: "crypto", value: "800", percent: "80.0" },
      { key: "fiat", value: "200", percent: "20.0" },
    ]);
  });
});
