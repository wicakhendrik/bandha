import { describe, expect, it } from "vitest";
import { DONATE_WALLETS, isValidWalletAddress, qrMatrix, qrPath } from "./donate";

describe("donation wallets", () => {
  it("every configured address has the right shape for its chain", () => {
    for (const w of DONATE_WALLETS) expect(isValidWalletAddress(w.kind, w.address), w.name).toBe(true);
  });
  it("rejects typical typos", () => {
    expect(isValidWalletAddress("evm", "0x44D3590011b625b3b1e8C3c3F9326A83F154a4f")).toBe(false); // one char short
    expect(isValidWalletAddress("evm", "0x44D3590011b625b3b1e8C3c3F9326A83F154a4fZ")).toBe(false); // not hex
    expect(isValidWalletAddress("sui", "0x44D3590011b625b3b1e8C3c3F9326A83F154a4f5")).toBe(false); // evm length
    expect(isValidWalletAddress("solana", "6ffRXbnsNeC712YPfaUHaQdTSkjVyb2cG4PX6bmnVvg0")).toBe(false); // 0 is not base58
  });
  it("addresses are unique", () => {
    expect(new Set(DONATE_WALLETS.map((w) => w.address)).size).toBe(DONATE_WALLETS.length);
  });
});

describe("qr", () => {
  it("builds a square matrix with the three finder patterns", () => {
    const m = qrMatrix(DONATE_WALLETS[0]!.address);
    expect(m.length).toBeGreaterThanOrEqual(25);
    expect(m.every((r) => r.length === m.length)).toBe(true);
    const n = m.length;
    // finder pattern corners are dark: top-left, top-right, bottom-left
    expect(m[0]![0] && m[0]![n - 1] && m[n - 1]![0]).toBe(true);
  });
  it("path covers exactly the dark modules", () => {
    const m = [[true, true, false], [false, true, false], [true, false, true]];
    expect(qrPath(m)).toBe("M0 0h2v1h-2zM1 1h1v1h-1zM0 2h1v1h-1zM2 2h1v1h-1z");
  });
});
