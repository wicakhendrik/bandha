import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { HttpError } from "./errors";

/** What the API takes from a verified Google ID token. */
export interface GoogleProfile {
  /** Google's stable account id. Unlike the email it never changes and is never reused. */
  sub: string;
  email: string;
  name: string;
}

/** Checks a Google ID token and returns who it belongs to. Injectable so tests never call Google. */
export interface GoogleVerifier {
  verify(idToken: string): Promise<GoogleProfile>;
}

const GOOGLE_CERTS = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

const invalid = () => new HttpError(401, "Login Google tidak valid. Coba lagi.", { code: "google_invalid" });

/**
 * Verifies the token's signature against Google's published keys (cached and rotated by jose), then its issuer, audience
 * (must be one of our client ids), expiry, and that Google itself confirmed the email address.
 * `keys` is only for tests.
 */
export function createGoogleVerifier(clientIds: string[], keys: JWTVerifyGetKey = createRemoteJWKSet(new URL(GOOGLE_CERTS))): GoogleVerifier {
  return {
    async verify(idToken) {
      let payload;
      try {
        ({ payload } = await jwtVerify(idToken, keys, { algorithms: ["RS256"], issuer: GOOGLE_ISSUERS, audience: clientIds }));
      } catch {
        throw invalid();
      }
      const { sub, email, email_verified: verified, name } = payload as { sub?: unknown; email?: unknown; email_verified?: unknown; name?: unknown };
      if (typeof sub !== "string" || !sub || typeof email !== "string" || !email) throw invalid();
      // Some tokens carry the flag as the string "true". Anything else means Google did not vouch for the address.
      if (verified !== true && verified !== "true") {
        throw new HttpError(403, "Email Google Anda belum terverifikasi.", { code: "google_email_unverified" });
      }
      const address = email.trim().toLowerCase();
      return { sub, email: address, name: typeof name === "string" && name.trim() ? name.trim().slice(0, 80) : address.split("@")[0]!.slice(0, 80) };
    },
  };
}
