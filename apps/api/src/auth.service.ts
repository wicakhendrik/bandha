import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { passwordResets, sessions, users, workspaces, type Db } from "@bandha/db";
import type { AuthTokens, LoginInput, PublicUser, RegisterInput } from "@bandha/validation";
import {
  ACCESS_TTL_SECONDS, REFRESH_TTL_DAYS, hashPassword, hashToken, isLegacyHash, newRefreshToken, signAccessToken, verifyPassword,
} from "./security";
import { HttpError } from "./errors";
import { resetPasswordEmail, type Mailer } from "./mailer";
import { isUniqueViolation } from "./types";

export const RESET_TTL_MINUTES = 30;
/** At most this many reset emails per account per hour; more requests are silently ignored. */
const RESET_PER_HOUR = 3;

export class AuthError extends Error {
  constructor(public readonly status: 401 | 409, message: string) {
    super(message);
  }
}

// Verified against a real hash so unknown emails cost the same time as wrong passwords.
const DUMMY_HASH = await hashPassword("dummy-password-for-timing");

export class AuthService {
  constructor(private readonly db: Db, private readonly secret: string) {}

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

  /** Registration also creates the user's single internal personal ledger. */
  async register(input: RegisterInput, userAgent: string | null): Promise<{ user: PublicUser; tokens: AuthTokens }> {
    const passwordHash = await hashPassword(input.password);
    let created: { user: PublicUser; workspaceId: string };
    try {
      created = await this.db.transaction(async (tx) => {
        const [u] = await tx.insert(users).values({ email: input.email, name: input.name, passwordHash }).returning();
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
    // A hash carried over from FinMap is upgraded to the native format now that the password is known.
    if (isLegacyHash(u.passwordHash)) {
      await this.db.update(users).set({ passwordHash: await hashPassword(input.password), updatedAt: new Date() }).where(eq(users.id, u.id));
    }
    const workspaceId = await this.workspaceIdOf(u.id);
    const tokens = await this.issue(u.id, workspaceId, crypto.randomUUID(), userAgent);
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
      await tx.update(users).set({ passwordHash, updatedAt: now }).where(eq(users.id, r.userId));
      await tx.update(passwordResets).set({ usedAt: now }).where(and(eq(passwordResets.userId, r.userId), isNull(passwordResets.usedAt)));
      await tx.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.userId, r.userId), isNull(sessions.revokedAt)));
    });
  }
}
