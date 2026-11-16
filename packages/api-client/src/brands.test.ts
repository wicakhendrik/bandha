import { describe, expect, it } from "vitest";
import { BRANDS, accountBadge, brandByKey, coinSpec, guessBrand, initialsOf } from "./brands";

describe("guessBrand (whole-word matching)", () => {
  it("finds the brand inside a free-text account name", () => {
    expect(guessBrand("Tabungan BCA")?.key).toBe("bca");
    expect(guessBrand("Dompet digital GoPay")?.key).toBe("gopay");
    expect(guessBrand("Indodax")?.key).toBe("indodax");
    expect(guessBrand("Bank Mandiri - Giro")?.key).toBe("mandiri");
    expect(guessBrand("Go-Pay utama")?.key).toBe("gopay");
  });

  it("prefers the most specific alias (blu by BCA is not plain BCA)", () => {
    expect(guessBrand("blu by BCA")?.key).toBe("blu");
  });

  it("never matches inside another word", () => {
    expect(guessBrand("Brimob")).toBeUndefined();
    expect(guessBrand("Solusi")).toBeUndefined();
    expect(guessBrand("Danamon")).toBeUndefined();
    expect(guessBrand("Tabungan umum")).toBeUndefined();
  });

  it("every brand has a unique key, a mark and a valid colour", () => {
    const keys = new Set(BRANDS.map((b) => b.key));
    expect(keys.size).toBe(BRANDS.length);
    for (const b of BRANDS) {
      expect(b.mark.length).toBeGreaterThan(0);
      expect(b.bg).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(brandByKey(b.key)).toBe(b);
    }
  });
});

describe("accountBadge", () => {
  it("uses the explicit brandKey over a name guess", () => {
    expect(accountBadge({ brandKey: "ovo", name: "Tabungan BCA", kind: "bank" }).mark).toBe("OVO");
  });

  it("guesses from the name when no brandKey is stored", () => {
    expect(accountBadge({ name: "Tabungan BCA", kind: "bank" }).mark).toBe("BCA");
  });

  it("uses a real vector glyph where the open set has one", () => {
    expect(accountBadge({ brandKey: "binance", name: "x", kind: "exchange" }).glyph?.path.length).toBeGreaterThan(50);
  });

  it("falls back to initials in a colour by account kind", () => {
    const s = accountBadge({ name: "Tabungan umum", kind: "bank" });
    expect(s.mark).toBe("TU");
    expect(s.bg).toBe("#5C3A21");
    expect(accountBadge({ name: "Kas", kind: "unknown-kind" }).bg).toMatch(/^#/);
  });

  it("initials helper", () => {
    expect(initialsOf("Dana Darurat")).toBe("DD");
    expect(initialsOf("emas")).toBe("EM");
  });
});

describe("coinSpec", () => {
  it("returns a real vector icon for common coins", () => {
    for (const sym of ["BTC", "ETH", "USDT", "USDC", "SOL", "BNB", "XRP", "DOGE", "DOT"]) {
      const c = coinSpec(sym);
      expect(c.type, sym).toBe("icon");
      if (c.type === "icon") expect(c.paths.length).toBeGreaterThan(0);
    }
  });

  it("is case-insensitive", () => {
    expect(coinSpec("btc")).toEqual(coinSpec("BTC"));
  });

  it("badges for fiat and gold, with sensible marks", () => {
    expect(coinSpec("IDR")).toMatchObject({ type: "badge", mark: "Rp" });
    expect(coinSpec("USD")).toMatchObject({ type: "badge", mark: "$" });
    expect(coinSpec("XAU")).toMatchObject({ type: "badge", mark: "Au" });
    expect(coinSpec("ADA")).toMatchObject({ type: "badge", mark: "ADA" });
  });

  it("unknown tokens get a stable generated colour and a short mark", () => {
    const a = coinSpec("ZZZCOIN");
    expect(a).toEqual(coinSpec("ZZZCOIN"));
    expect(a).toMatchObject({ type: "badge", mark: "ZZZC" });
  });
});
