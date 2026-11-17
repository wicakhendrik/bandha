import { and, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { adminAudit, sessions, users, type Db } from "@bandha/db";
import { HttpError } from "./errors";

export type UserStatus = "all" | "active" | "disabled" | "unverified";

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  verified: boolean;
  disabledAt: string | null;
  createdAt: string;
  /** Most recent sign-in or token refresh. */
  lastActiveAt: string | null;
  /** Counts only: admins never see balances or transaction details. */
  accounts: number;
  transactions: number;
}

export interface AdminStats {
  users: { total: number; verified: number; unverified: number; disabled: number; admins: number };
  newUsers: { last7d: number; last30d: number };
  active: { last24h: number; last7d: number; last30d: number };
  /** Sign-ups per day (Asia/Jakarta) for the last 30 days, oldest first, zeros included. */
  signups: Array<{ day: string; count: number }>;
  data: { accounts: number; transactions: number };
  market: { quotes: number; lastQuoteAt: string | null };
}

export interface AuditRow {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string | null;
  detail: string | null;
}

const TZ = "Asia/Jakarta";
const iso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : null);
/** `%` and `_` typed by the admin must match themselves, not act as wildcards. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/**
 * Admin tools: look at registered people, disable or re-enable accounts, sign them out, see counters and the audit
 * trail. Deliberately no access to anyone's financial data. Admin rights are never granted through this service (only
 * by the make-admin command), and admin accounts cannot be disabled from here.
 */
export class AdminService {
  constructor(private readonly db: Db) {}

  async listUsers(opts: { q?: string; status?: UserStatus; limit: number; offset: number }): Promise<{ users: AdminUserRow[]; total: number }> {
    const conds: SQL[] = [];
    const q = opts.q?.trim();
    if (q) {
      const like = `%${escapeLike(q)}%`;
      conds.push(or(ilike(users.email, like), ilike(users.name, like))!);
    }
    if (opts.status === "disabled") conds.push(isNotNull(users.disabledAt));
    else if (opts.status === "unverified") conds.push(isNull(users.emailVerifiedAt));
    else if (opts.status === "active") conds.push(and(isNull(users.disabledAt), isNotNull(users.emailVerifiedAt))!);
    const where = conds.length ? and(...conds) : undefined;

    const rows = await this.db
      .select({
        id: users.id, name: users.name, email: users.email, role: users.role, verifiedAt: users.emailVerifiedAt, disabledAt: users.disabledAt, createdAt: users.createdAt,
        lastActiveAt: sql<Date | null>`(select max(s.created_at) from sessions s where s.user_id = users.id)`,
        accounts: sql<number>`(select count(*)::int from accounts a join workspaces w on w.id = a.workspace_id
          where w.owner_user_id = users.id and not a.is_system and a.archived_at is null)`,
        transactions: sql<number>`(select count(*)::int from transactions t join workspaces w on w.id = t.workspace_id
          where w.owner_user_id = users.id and t.status = 'posted' and t.type <> 'opening')`,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt), users.id)
      .limit(opts.limit)
      .offset(opts.offset);
    const [{ total } = { total: 0 }] = await this.db.select({ total: sql<number>`count(*)::int` }).from(users).where(where);

    return {
      total,
      users: rows.map((r) => ({
        id: r.id, name: r.name, email: r.email, role: r.role, verified: r.verifiedAt !== null, disabledAt: iso(r.disabledAt),
        createdAt: iso(r.createdAt)!, lastActiveAt: iso(r.lastActiveAt), accounts: r.accounts, transactions: r.transactions,
      })),
    };
  }

  async stats(): Promise<AdminStats> {
    const one = async (query: SQL) => ((await this.db.execute(query)).rows[0] ?? {}) as Record<string, number | string | null>;
    const u = await one(sql`
      select count(*)::int as total,
             count(*) filter (where email_verified_at is not null)::int as verified,
             count(*) filter (where email_verified_at is null)::int as unverified,
             count(*) filter (where disabled_at is not null)::int as disabled,
             count(*) filter (where role = 'admin')::int as admins,
             count(*) filter (where created_at > now() - interval '7 days')::int as new7,
             count(*) filter (where created_at > now() - interval '30 days')::int as new30
      from users`);
    const a = await one(sql`
      select count(distinct user_id) filter (where created_at > now() - interval '1 day')::int as d1,
             count(distinct user_id) filter (where created_at > now() - interval '7 days')::int as d7,
             count(distinct user_id) filter (where created_at > now() - interval '30 days')::int as d30
      from sessions`);
    const d = await one(sql`
      select (select count(*)::int from accounts where not is_system and archived_at is null) as accounts,
             (select count(*)::int from transactions where status = 'posted' and type <> 'opening') as transactions`);
    const m = await one(sql`select count(*)::int as quotes, max(as_of) as last from market_quotes_latest`);
    const perDay = (await this.db.execute(sql`
      select to_char(created_at at time zone ${TZ}, 'YYYY-MM-DD') as day, count(*)::int as count
      from users where created_at > now() - interval '31 days' group by 1`)).rows as Array<{ day: string; count: number }>;

    // Fill every one of the last 30 days, so the chart has no gaps.
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
    const signups: AdminStats["signups"] = [];
    for (let i = 29; i >= 0; i--) {
      const day = new Date(new Date(`${today}T12:00:00+07:00`).getTime() - i * 86_400_000).toLocaleDateString("en-CA", { timeZone: TZ });
      signups.push({ day, count: perDay.find((r) => r.day === day)?.count ?? 0 });
    }

    return {
      users: { total: Number(u.total), verified: Number(u.verified), unverified: Number(u.unverified), disabled: Number(u.disabled), admins: Number(u.admins) },
      newUsers: { last7d: Number(u.new7), last30d: Number(u.new30) },
      active: { last24h: Number(a.d1), last7d: Number(a.d7), last30d: Number(a.d30) },
      signups,
      data: { accounts: Number(d.accounts), transactions: Number(d.transactions) },
      market: { quotes: Number(m.quotes), lastQuoteAt: iso(m.last as string | null) },
    };
  }

  /** Disables or re-enables an account. Disabling also signs every device out. Repeating the same call changes nothing and logs nothing. */
  async setDisabled(actor: { id: string; email: string }, targetId: string, disabled: boolean, reason?: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [t] = await tx.select().from(users).where(eq(users.id, targetId)).for("update");
      if (!t) throw new HttpError(404, "Pengguna tidak ditemukan");
      if (disabled) {
        if (t.id === actor.id) throw new HttpError(400, "Anda tidak bisa menonaktifkan akun sendiri");
        if (t.role === "admin") throw new HttpError(409, "Akun admin tidak bisa dinonaktifkan dari panel. Cabut peran admin dulu lewat perintah make-admin");
      }
      if ((t.disabledAt !== null) === disabled) return;
      const now = new Date();
      await tx.update(users).set({ disabledAt: disabled ? now : null, updatedAt: now }).where(eq(users.id, t.id));
      if (disabled) await tx.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.userId, t.id), isNull(sessions.revokedAt)));
      await tx.insert(adminAudit).values({
        actorUserId: actor.id, actorEmail: actor.email, action: disabled ? "user.disable" : "user.enable",
        targetUserId: t.id, targetEmail: t.email, detail: reason?.trim() || null,
      });
    });
  }

  /** Signs a person out of every device without disabling the account. */
  async revokeSessions(actor: { id: string; email: string }, targetId: string): Promise<{ revoked: number }> {
    return this.db.transaction(async (tx) => {
      const [t] = await tx.select().from(users).where(eq(users.id, targetId));
      if (!t) throw new HttpError(404, "Pengguna tidak ditemukan");
      if (t.id === actor.id) throw new HttpError(400, "Untuk keluar dari akun sendiri, pakai tombol Keluar");
      const done = await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, t.id), isNull(sessions.revokedAt))).returning({ id: sessions.id });
      await tx.insert(adminAudit).values({ actorUserId: actor.id, actorEmail: actor.email, action: "user.revoke_sessions", targetUserId: t.id, targetEmail: t.email, detail: `${done.length} sesi` });
      return { revoked: done.length };
    });
  }

  async audit(opts: { limit: number; offset: number }): Promise<{ entries: AuditRow[]; total: number }> {
    const rows = await this.db.select().from(adminAudit).orderBy(desc(adminAudit.createdAt), desc(adminAudit.id)).limit(opts.limit).offset(opts.offset);
    const [{ total } = { total: 0 }] = await this.db.select({ total: sql<number>`count(*)::int` }).from(adminAudit);
    return {
      total,
      entries: rows.map((r) => ({ id: r.id, at: iso(r.createdAt)!, actor: r.actorEmail, action: r.action, target: r.targetEmail, detail: r.detail })),
    };
  }
}
