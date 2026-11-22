import { SignJWT, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createGoogleVerifier } from "./google";

const CLIENT = "123-web.apps.googleusercontent.com";
const ISS = "https://accounts.google.com";

let pair: Awaited<ReturnType<typeof generateKeyPair>>;
let other: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => {
  pair = await generateKeyPair("RS256");
  other = await generateKeyPair("RS256");
});

const verifier = () => createGoogleVerifier([CLIENT, "second.apps.googleusercontent.com"], async () => pair.publicKey);

function token(claims: Record<string, unknown> = {}, o: { iss?: string; aud?: string; exp?: string; key?: CryptoKey } = {}) {
  return new SignJWT({ sub: "g-1", email: "Budi@Gmail.com", email_verified: true, name: "Budi Santoso", ...claims })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(o.iss ?? ISS)
    .setAudience(o.aud ?? CLIENT)
    .setIssuedAt()
    .setExpirationTime(o.exp ?? "10m")
    .sign(o.key ?? pair.privateKey);
}

describe("Google ID token verification", () => {
  it("accepts a good token and lowercases the address", async () => {
    expect(await verifier().verify(await token())).toEqual({ sub: "g-1", email: "budi@gmail.com", name: "Budi Santoso" });
  });

  it("accepts either issuer spelling and any configured client id", async () => {
    await expect(verifier().verify(await token({}, { iss: "accounts.google.com" }))).resolves.toBeTruthy();
    await expect(verifier().verify(await token({}, { aud: "second.apps.googleusercontent.com" }))).resolves.toBeTruthy();
  });

  it("falls back to the part before the @ when Google sends no name", async () => {
    expect((await verifier().verify(await token({ name: undefined }))).name).toBe("budi");
  });

  it("refuses a token issued for another app", async () => {
    await expect(verifier().verify(await token({}, { aud: "someone-else.apps.googleusercontent.com" }))).rejects.toMatchObject({ status: 401, extra: { code: "google_invalid" } });
  });

  it("refuses another issuer, an expired token and a token signed with a different key", async () => {
    await expect(verifier().verify(await token({}, { iss: "https://evil.example.com" }))).rejects.toMatchObject({ status: 401 });
    await expect(verifier().verify(await token({}, { exp: "-1m" }))).rejects.toMatchObject({ status: 401 });
    await expect(verifier().verify(await token({}, { key: other.privateKey }))).rejects.toMatchObject({ status: 401 });
  });

  it("refuses garbage and tokens without an id or address", async () => {
    await expect(verifier().verify("not-a-jwt")).rejects.toMatchObject({ status: 401 });
    await expect(verifier().verify(await token({ sub: undefined }))).rejects.toMatchObject({ status: 401 });
    await expect(verifier().verify(await token({ email: undefined }))).rejects.toMatchObject({ status: 401 });
  });

  it("refuses an address Google did not verify", async () => {
    await expect(verifier().verify(await token({ email_verified: false }))).rejects.toMatchObject({ status: 403, extra: { code: "google_email_unverified" } });
    await expect(verifier().verify(await token({ email_verified: undefined }))).rejects.toMatchObject({ status: 403 });
  });

  it("refuses an unsigned token (alg none)", async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const forged = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: "g-1", email: "a@b.co", email_verified: true, iss: ISS, aud: CLIENT, exp: Math.floor(Date.now() / 1000) + 600 })}.`;
    await expect(verifier().verify(forged)).rejects.toMatchObject({ status: 401 });
  });
});
