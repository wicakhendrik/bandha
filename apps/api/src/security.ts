import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { verify as argon2Verify } from "@node-rs/argon2";
import { SignJWT, jwtVerify } from "jose";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

const N = 2 ** 15;
const KEYLEN = 64;
// N=2^15, r=8 needs ~32MB, which is right at Node's default limit.
const MAXMEM = 128 * 1024 * 1024;

/** Format: scrypt$N$r$p$saltB64$hashB64 (self-describing so parameters can be raised later). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, { N, r: 8, p: 1, maxmem: MAXMEM });
  return `scrypt$${N}$8$1$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/**
 * Passwords carried over from FinMap are argon2 hashes ("$argon2id$..."). They are accepted so migrated people keep
 * their password, and replaced by a scrypt hash on their first successful login (see AuthService.login).
 */
export const isLegacyHash = (stored: string): boolean => stored.startsWith("$argon2");

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (isLegacyHash(stored)) {
    try { return await argon2Verify(stored, password); } catch { return false; }
  }
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Opaque random refresh token; only its SHA-256 is stored. */
export function newRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_DAYS = 30;

const key = (secret: string) => new TextEncoder().encode(secret);

export async function signAccessToken(secret: string, claims: { userId: string; workspaceId: string }): Promise<string> {
  return new SignJWT({ wid: claims.workspaceId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(key(secret));
}

export async function verifyAccessToken(secret: string, token: string): Promise<{ userId: string; workspaceId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.wid !== "string") return null;
    return { userId: payload.sub, workspaceId: payload.wid };
  } catch {
    return null;
  }
}
