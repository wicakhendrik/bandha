import { describe, expect, it } from "vitest";
import { hashPassword, hashToken, newRefreshToken, signAccessToken, verifyAccessToken, verifyPassword } from "./security";

const SECRET = "x".repeat(40);

describe("password hashing", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong password!!", h)).toBe(false);
  });

  it("salts: same password gives different hashes", async () => {
    expect(await hashPassword("same-password-1")).not.toBe(await hashPassword("same-password-1"));
  });

  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("tokens", () => {
  it("refresh tokens are random and hashed deterministically", () => {
    const a = newRefreshToken();
    expect(a).not.toBe(newRefreshToken());
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(a);
  });

  it("access token round-trips and rejects tampering or a wrong secret", async () => {
    const t = await signAccessToken(SECRET, { userId: "u1", workspaceId: "w1" });
    expect(await verifyAccessToken(SECRET, t)).toEqual({ userId: "u1", workspaceId: "w1" });
    expect(await verifyAccessToken("y".repeat(40), t)).toBeNull();
    expect(await verifyAccessToken(SECRET, t.slice(0, -2) + "ab")).toBeNull();
  });
});
