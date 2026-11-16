import { afterEach, describe, expect, it } from "vitest";
import {
  ACCOUNT_FILTERS, ASSET_CLASS_OF_CATEGORY, BRANDS, CATEGORY_LABEL, KIND_OF_CATEGORY, accountKindLabel, assetKindLabel, brandByKey,
  categoryLabel, dateLong, dateShort, greeting, guessBrand, monthLabel, monthYear, pct, qty, rp, setLang, shiftMonth, signedRp, txTypeLabel,
} from "./index";

afterEach(() => setLang("id"));

describe("language", () => {
  it("labels follow the selected language and fall back to the key when unknown", () => {
    expect(txTypeLabel("income")).toBe("Pemasukan");
    expect(accountKindLabel("exchange")).toBe("Bursa kripto");
    expect(assetKindLabel("crypto")).toBe("Kripto");
    setLang("en");
    expect(txTypeLabel("income")).toBe("Income");
    expect(accountKindLabel("exchange")).toBe("Crypto exchange");
    expect(accountKindLabel("wallet")).toBe("Crypto wallet");
    expect(assetKindLabel("fiat")).toBe("Cash & bank");
    expect(categoryLabel("gold")).toBe("Gold");
    expect(txTypeLabel("something-new")).toBe("something-new");
  });

  it("numbers use the separators of the language (1.234,5 vs 1,234.5)", () => {
    expect(rp("1234567")).toBe("Rp 1.234.567");
    expect(qty("1234.5")).toBe("1.234,5");
    expect(pct("57.89")).toBe("+57,89%");
    setLang("en");
    expect(rp("1234567")).toBe("Rp 1,234,567");
    expect(signedRp("-5500000")).toBe("−Rp 5,500,000");
    expect(qty("1234.5")).toBe("1,234.5");
    expect(pct("57.89")).toBe("+57.89%");
  });

  it("dates and greetings are localised", () => {
    const d = new Date("2026-05-17T05:00:00Z"); // 12:00 WIB, a Sunday
    expect(dateLong(d)).toBe("Minggu, 17 Mei 2026");
    expect(dateShort("2026-05-17T05:00:00Z")).toBe("17 Mei");
    expect(greeting(d)).toBe("Sugeng siang");
    expect(monthLabel("2026-08")).toBe("Agu");
    setLang("en");
    expect(dateLong(d)).toBe("Sunday, 17 May 2026");
    expect(dateShort("2026-05-17T05:00:00Z")).toBe("17 May");
    expect(greeting(d)).toBe("Good afternoon");
    expect(monthLabel("2026-08")).toBe("Aug");
    expect(monthYear("2026-11")).toBe("November 2026");
  });

  it("shiftMonth crosses year boundaries in both directions", () => {
    expect(shiftMonth("2026-11", 1)).toBe("2026-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-03", -14)).toBe("2025-01");
  });
});

describe("Jenis (one choice drives the account type and the asset class)", () => {
  const categories = Object.keys(CATEGORY_LABEL) as Array<keyof typeof CATEGORY_LABEL>;

  it("every category maps to a stored account kind and an asset class", () => {
    for (const c of categories) {
      expect(KIND_OF_CATEGORY[c], c).toBeTruthy();
      expect(["fiat", "crypto", "gold"]).toContain(ASSET_CLASS_OF_CATEGORY[c]);
    }
  });

  it("matches the requested rules: banks and e-wallets hold currencies, exchanges and wallets hold crypto, gold holds grams", () => {
    expect(ASSET_CLASS_OF_CATEGORY).toMatchObject({ bank: "fiat", ewallet: "fiat", exchange: "crypto", wallet: "crypto", gold: "gold" });
    expect(KIND_OF_CATEGORY).toMatchObject({ exchange: "exchange", wallet: "wallet", gold: "gold" });
  });

  it("every brand belongs to a known category, and each category has a generic fallback", () => {
    for (const b of BRANDS) expect(categories, b.key).toContain(b.category);
    for (const c of ["bank", "ewallet", "exchange", "wallet", "broker", "gold"] as const) {
      expect(BRANDS.some((b) => b.category === c && b.key.endsWith("lainnya")), c).toBe(true);
    }
    expect(BRANDS.filter((b) => b.category === "gold").map((b) => b.key)).toEqual(expect.arrayContaining(["antam", "pegadaian"]));
  });

  it("generic brands are not guessed from ordinary account names", () => {
    expect(guessBrand("Bank lainnya")?.key).toBe("bank-lainnya");
    expect(guessBrand("Tabungan bank")).toBeUndefined();
    expect(brandByKey("wallet-lainnya")?.category).toBe("wallet");
  });

  it("the type filters cover every stored account kind exactly once", () => {
    const covered = ACCOUNT_FILTERS.flatMap((f) => f.kinds);
    expect(new Set(covered).size).toBe(covered.length);
    for (const kind of ["cash", "bank", "ewallet", "exchange", "wallet", "brokerage", "gold", "property", "other"]) expect(covered, kind).toContain(kind);
  });
});
