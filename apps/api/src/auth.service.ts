import { randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { emailVerifications, passwordResets, sessions, users, workspaces, type Db } from "@bandha/db";
import type { AuthTokens, LoginInput, PublicUser, RegisterInput } from "@bandha/validation";
import {
  ACCESS_TTL_SECONDS, REFRESH_TTL_DAYS, hashPassword, hashToken, isLegacyHash, newRefreshToken, signAccessToken, verifyPassword,
} from "./security";
import { HttpError } from "./errors";
import { resetPasswordEmail, verificationEmail, type Mailer } from "./mailer";
import { isUniqueViolation } from "./types";

export const RESET_TTL_MINUTES = 30;
/** At most this many reset emails per account per hour; more requests are silently ignored. */
const RESET_PER_HOUR = 3;

/** Registration codes: valid for 10 minutes, 5 wrong guesses burn the code, at most 1 email per minute and 5 per hour. */
export const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_SECONDS = 60;
const OTP_PER_HOUR = 5;

const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
// Bound to the user so the same code never hashes to the same value for two people.
const codeHash = (userId: string, code: string) => hashToken(`otp:${userId}:${code}`);
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export type RegisterResult =
  | { user: PublicUser; tokens: AuthTokens; verificationRequired?: undefined }
  | { verificationRequired: true; email: string; resendInSeconds: number };

export interface AuthOptions {
  /** Registration must be confirmed with an emailed code. */
  requireEmailOtp: boolean;
  mailer: Mailer;
}

export class AuthError extends Error {
  constructor(public readonly status: 401 | 409, message: string) {
    super(message);
  }
}

// Verified against a real hash so unknown emails cost the same time as wrong passwords.
const DUMMY_HASH = await hashPassword("dummy-password-for-timing");

export class AuthService {
  constructor(private readonly db: Db, private readonly secret: string, private readonly opts: AuthOptions = { requireEmailOtp: false, mailer: { send: async () => undefined } }) {}

  private async issue(userId: string, workspaceId: string, familyId: string, userAgent: string | null): Promise<AuthTokens> {
    const refreshToken = newRefreshToken();
    await this.db.insert(sessions).values({
      userId,
      familyId,
      tokenHash: hashToken(refreshToken),
      userAgent,
      expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000),
    });
    const accessToken = await signAccessToken(this.secret, { userId, workspaceId });
    return { accessToken, refreshToken, expiresIn: ACCESS_TTL_SECONDS };
  }

  private async workspaceIdOf(userId: string): Promise<string> {
    const [ws] = await this.db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.ownerUserId, userId));
    if (!ws) throw new AuthError(401, "Workspace not found");
    return ws.id;
  }

  /**
   * Registration also creates the user's single internal personal ledger. With email verification on (the default) the
   * account is created unverified and no session is issued: a 6-digit code is emailed and `verifyEmail` finishes the job.
   * Registering again with an address that never confirmed simply replaces the pending name and password (nothing was
   * ever stored for it), so nobody can lock another person's email address by registering it first.
   */
  async register(input: RegisterInput, userAgent: string | null): Promise<RegisterResult> {
    const passwordHash = await hashPassword(input.password);
    if (this.opts.requireEmailOtp) {
      const userId = await this.db.transaction(async (tx) => {
        const [existing] = await tx.select().from(users).where(eq(users.email, input.email)).for("update");
        if (existing) {
          if (existing.emailVerifiedAt) throw new AuthError(409, "Email sudah terdaftar");
          await tx.update(users).set({ name: input.name, passwordHash, updatedAt: new Date() }).where(eq(users.id, existing.id));
          return existing.id;
        }
        const [u] = await tx.insert(users).values({ email: input.email, name: input.name, passwordHash }).returning({ id: users.id });
        if (!u) throw new Error("User insert failed");
        const [w] = await tx.insert(workspaces).values({ ownerUserId: u.id }).returning({ id: workspaces.id });
        if (!w) throw new Error("Workspace insert failed");
        return u.id;
      }).catch((err) => {
        if (isUniqueViolation(err)) throw new AuthError(409, "Email sudah terdaftar");
        throw err;
      });
      await this.sendCode(userId, input.email);
      return { verificationRequired: true, email: input.email, resendInSeconds: OTP_RESEND_SECONDS };
    }
    let created: { user: PublicUser; workspaceId: string };
    try {
      created = await this.db.transaction(async (tx) => {
        const [u] = await tx.insert(users).values({ email: input.email, name: input.name, passwordHash, emailVerifiedAt: new Date() }).returning();
        if (!u) throw new Error("User insert failed");
        const [w] = await tx.insert(workspaces).values({ ownerUserId: u.id }).returning();
        if (!w) throw new Error("Workspace insert failed");
        return { user: { id: u.id, name: u.name, email: u.email }, workspaceId: w.id };
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new AuthError(409, "Email sudah terdaftar");
      throw err;
    }
    const tokens = await this.issue(created.user.id, created.workspaceId, crypto.randomUUID(), userAgent);
    return { user: created.user, tokens };
  }

  async login(input: LoginInput, userAgent: string | null): Promise<{ user: PublicUser; tokens: AuthTokens }> {
    const [u] = await this.db.select().from(users).where(eq(users.email, input.email));
    const ok = await verifyPassword(input.password, u?.passwordHash ?? DUMMY_HASH);
    if (!u || !ok) throw new AuthError(401, "Email atau kata sandi salah");
    if (this.opts.requireEmailOtp && !u.emailVerifiedAt) {
      // The password is right but the address was never confirmed: send a fresh code (within the limits) and say so.
      await this.sendCode(u.id, u.email).catch(() => undefined);
      throw new HttpError(403, "Email belum diverifikasi. Kami mengirim kode ke email Anda.", { code: "email_unverified", email: u.email });
    }
    // A hash carried over from FinMap is upgraded to the native format now that the password is known.
    if (isLegacyHash(u.passwordHash)) {
      await this.db.update(users).set({ passwordHash: await hashPassword(input.password), updatedAt: new Date() }).where(eq(users.id, u.id));
    }
    const workspaceId = await this.workspaceIdOf(u.id);
    const tokens = await this.issue(u.id, workspaceId, crypto.randomUUID(), userAgent);
    return { user: { id: u.id, name: u.name, email: u.email }, tokens };
  }

  /**
   * Emails a new 6-digit code unless one was sent less than a minute ago or five went out this hour (then it quietly does
   * nothing, so a client cannot be used to flood a mailbox). A new code replaces the previous one.
   */
  private async sendCode(userId: string, email: string): Promise<void> {
    const now = Date.now();
    const [last] = await this.db.select({ createdAt: emailVerifications.createdAt }).from(emailVerifications)
      .where(eq(emailVerifications.userId, userId)).orderBy(desc(emailVerifications.createdAt)).limit(1);
    if (last && now - last.createdAt.getTime() < OTP_RESEND_SECONDS * 1000) return;
    const [recent] = await this.db.select({ n: sql<number>`count(*)::int` }).from(emailVerifications)
      .where(and(eq(emailVerifications.userId, userId), gt(emailVerifications.createdAt, new Date(now - 3_600_000))));
    if ((recent?.n ?? 0) >= OTP_PER_HOUR) return;

    const code = newCode();
    const [row] = await this.db.transaction(async (tx) => {
      await tx.update(emailVerifications).set({ usedAt: new Date() }).where(and(eq(emailVerifications.userId, userId), isNull(emailVerifications.usedAt)));
      return tx.insert(emailVerifications).values({ userId, codeHash: codeHash(userId, code), expiresAt: new Date(now + OTP_TTL_MINUTES * 60_000) }).returning({ id: emailVerifications.id });
    });
    try {
      await this.opts.mailer.send(verificationEmail(email, code, OTP_TTL_MINUTES));
    } catch {
      // Never log the address or the error text (SMTP errors can echo credentials). The code could not be delivered, so drop it.
      console.error("Verification email could not be sent");
      if (row) await this.db.delete(emailVerifications).where(eq(emailVerifications.id, row.id));
      throw new HttpError(503, "Email verifikasi gagal dikirim. Coba lagi sebentar lagi.");
    }
  }

  /** Sends a new code to an address that has not confirmed itself yet. The answer never says whether the address exists. */
  async resendVerification(email: string): Promise<{ ok: true; resendInSeconds: number }> {
    const [u] = await this.db.select({ id: users.id, email: users.email, verified: users.emailVerifiedAt }).from(users).where(eq(users.email, email));
    if (u && !u.verified) await this.sendCode(u.id, u.email);
    return { ok: true, resendInSeconds: OTP_RESEND_SECONDS };
  }

  /** Confirms the emailed code. On success the account is verified and signed in (same result as login). */
  async verifyEmail(email: string, code: string, userAgent: string | null): Promise<{ user: PublicUser; tokens: AuthTokens }> {
    const wrong = () => new HttpError(400, "Kode salah atau sudah kedaluwarsa. Minta kode baru");
    const [u] = await this.db.select().from(users).where(eq(users.email, email));
    if (!u) throw wrong();
    if (u.emailVerifiedAt) throw new HttpError(409, "Email ini sudah terverifikasi. Silakan masuk");

    const [row] = await this.db.select().from(emailVerifications)
      .where(and(eq(emailVerifications.userId, u.id), isNull(emailVerifications.usedAt))).orderBy(desc(emailVerifications.createdAt)).limit(1);
    if (!row || row.expiresAt.getTime() < Date.now()) throw new HttpError(400, "Kode sudah kedaluwarsa. Minta kode baru");

    if (!sameHash(row.codeHash, codeHash(u.id, code))) {
      const [bumped] = await this.db.update(emailVerifications).set({ attempts: sql`${emailVerifications.attempts} + 1` })
        .where(eq(emailVerifications.id, row.id)).returning({ attempts: emailVerifications.attempts });
      const left = OTP_MAX_ATTEMPTS - (bumped?.attempts ?? OTP_MAX_ATTEMPTS);
      if (left <= 0) {
        await this.db.update(emailVerifications).set({ usedAt: new Date() }).where(eq(emailVerifications.id, row.id));
        throw new HttpError(400, "Terlalu banyak kode yang salah. Minta kode baru");
      }
      throw new HttpError(400, `Kode salah. Sisa percobaan: ${left}`);
    }
    if (row.attempts >= OTP_MAX_ATTEMPTS) throw new HttpError(400, "Terlalu banyak kode yang salah. Minta kode baru");

    // Atomic claim: a code can be used once, even if two requests race.
    const claimed = await this.db.update(emailVerifications).set({ usedAt: new Date() })
      .where(and(eq(emailVerifications.id, row.id), isNull(emailVerifications.usedAt))).returning({ id: emailVerifications.id });
    if (claimed.length === 0) throw wrong();
    await this.db.update(users).set({ emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, u.id));

    const tokens = await this.issue(u.id, await this.workspaceIdOf(u.id), crypto.randomUUID(), userAgent);
    return { user: { id: u.id, name: u.name, email: u.email }, tokens };
  }

  /**
   * Refresh-token rotation. Presenting an already-rotated or revoked token means it was
   * stolen or replayed, so the entire token family is revoked.
   */
  async refresh(refreshToken: string, userAgent: string | null): Promise<AuthTokens> {
    const [s] = await this.db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(refreshToken)));
    if (!s) throw new AuthError(401, "Sesi tidak valid");

    if (s.rotatedAt || s.revokedAt) {
      await this.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.familyId, s.familyId), isNull(sessions.revokedAt)));
      throw new AuthError(401, "Sesi tidak valid");
    }
    if (s.expiresAt.getTime() < Date.now()) throw new AuthError(401, "Sesi kedaluwarsa");

    // Atomic claim: only one concurrent request can rotate this token.
    const claimed = await this.db
      .update(sessions)
      .set({ rotatedAt: new Date() })
      .where(and(eq(sessions.id, s.id), isNull(sessions.rotatedAt), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    if (claimed.length === 0) throw new AuthError(401, "Sesi tidak valid");

    const workspaceId = await this.workspaceIdOf(s.userId);
    return this.issue(s.userId, workspaceId, s.familyId, userAgent);
  }

  async logout(refreshToken: string): Promise<void> {
    const [s] = await this.db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(refreshToken)));
    if (!s) return;
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.familyId, s.familyId), isNull(sessions.revokedAt)));
  }

  /** Renames the signed-in person. */
  async updateName(userId: string, name: string): Promise<PublicUser> {
    const [u] = await this.db.update(users).set({ name, updatedAt: new Date() }).where(eq(users.id, userId)).returning();
    if (!u) throw new AuthError(401, "Sesi tidak valid");
    return { id: u.id, name: u.name, email: u.email };
  }

  /**
   * Changes the password of someone who is signed in and knows the current one. Every session is revoked afterwards
   * (other devices are signed out), so the caller signs in again with the new password.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!u) throw new AuthError(401, "Sesi tidak valid");
    // 400, not 401: a wrong current password must not look like an expired session to the web client.
    if (!(await verifyPassword(currentPassword, u.passwordHash))) throw new HttpError(400, "Kata sandi saat ini salah");
    if (currentPassword === newPassword) throw new HttpError(400, "Kata sandi baru harus berbeda dari yang lama");
    const passwordHash = await hashPassword(newPassword);
    await this.db.transaction(async (tx) => {
      const now = new Date();
      await tx.update(users).set({ passwordHash, updatedAt: now }).where(eq(users.id, userId));
      await tx.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    });
  }

  async me(userId: string): Promise<PublicUser | null> {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    return u ? { id: u.id, name: u.name, email: u.email } : null;
  }

  /**
   * Starts a password reset. It never says whether the email exists (the caller always answers the same), and the
   * email is sent in the background so response time does not reveal it either. A new request replaces the previous
   * link; the token is random, single use, expires after 30 minutes, and only its hash is stored.
   */
  async requestReset(email: string, mailer: Mailer, baseUrl: string): Promise<void> {
    const [u] = await this.db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, email));
    if (!u) return;
    const hourAgo = new Date(Date.now() - 3_600_000);
    const [recent] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(passwordResets)
      .where(and(eq(passwordResets.userId, u.id), gt(passwordResets.createdAt, hourAgo)));
    if ((recent?.n ?? 0) >= RESET_PER_HOUR) return;

    const token = newRefreshToken();
    await this.db.transaction(async (tx) => {
      await tx.update(passwordResets).set({ usedAt: new Date() }).where(and(eq(passwordResets.userId, u.id), isNull(passwordResets.usedAt)));
      await tx.insert(passwordResets).values({ userId: u.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000) });
    });
    const link = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
    // Never log the address, the link or the error text (SMTP errors can echo credentials).
    void mailer.send(resetPasswordEmail(u.email, link, RESET_TTL_MINUTES)).catch(() => console.error("Reset email could not be sent"));
  }

  /**
   * Sets a new password from a reset token, then signs the account out everywhere: every refresh-token family is
   * revoked, so someone who had the old password is locked out as soon as their short-lived access token expires.
   */
  async resetPassword(token: string, password: string): Promise<void> {
    const passwordHash = await hashPassword(password);
    await this.db.transaction(async (tx) => {
      const [r] = await tx.select().from(passwordResets).where(eq(passwordResets.tokenHash, hashToken(token))).for("update");
      if (!r || r.usedAt || r.expiresAt.getTime() < Date.now()) throw new HttpError(400, "Tautan atur ulang tidak valid atau sudah kedaluwarsa. Minta tautan baru");
      const now = new Date();
      // Following the emailed link also proves the address, so an unverified account becomes verified here.
      await tx.update(users).set({ passwordHash, updatedAt: now, emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, ${now.toISOString()}::timestamptz)` }).where(eq(users.id, r.userId));
      await tx.update(passwordResets).set({ usedAt: now }).where(and(eq(passwordResets.userId, r.userId), isNull(passwordResets.usedAt)));
      await tx.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.userId, r.userId), isNull(sessions.revokedAt)));
    });
  }
}
