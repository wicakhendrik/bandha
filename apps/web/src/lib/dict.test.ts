import { describe, expect, it } from "vitest";
import { DICT } from "./dict";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("translations", () => {
  const keys = Object.keys(DICT.id) as Array<keyof typeof DICT.id>;

  it("English defines exactly the same keys as Indonesian", () => {
    expect(Object.keys(DICT.en).sort()).toEqual([...keys].sort());
  });

  it("no text is empty", () => {
    for (const k of keys) {
      expect(DICT.id[k].trim(), `id ${k}`).not.toBe("");
      expect(DICT.en[k].trim(), `en ${k}`).not.toBe("");
    }
  });

  it("both languages use the same {placeholders}, so no raw braces ever reach the screen", () => {
    for (const k of keys) expect(placeholders(DICT.en[k]), k).toEqual(placeholders(DICT.id[k]));
  });

  it("English is actually translated (not a copy of the Indonesian text) for ordinary words", () => {
    const same = keys.filter((k) => DICT.id[k] === DICT.en[k]);
    // Proper names and loanwords (Email, Transfer, Bandha motto, "ID"/"EN"...) may legitimately match; the vast majority must differ.
    expect(same.length / keys.length).toBeLessThan(0.1);
  });
});
