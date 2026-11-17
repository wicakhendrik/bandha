import { Hono, type Context, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { ZodType } from "zod";
import { eq } from "drizzle-orm";
import { users, type Db } from "@bandha/db";
import {
  addCryptoSchema, createAccountSchema, createDebtSchema, createTransactionSchema, loginSchema, refreshSchema, registerSchema, replaceTransactionSchema, forgotPasswordSchema, resetPasswordSchema,
  importCommitSchema, importPreviewSchema, settleDebtSchema, updateAccountSchema, updateDebtSchema, updateTransactionSchema, updateProfileSchema, changePasswordSchema, verifyEmailSchema,
} from "@bandha/validation";
import { AccountsService } from "./accounts.service";
import { AdminService, type UserStatus } from "./admin.service";
import { isAssetKind } from "./assets.service";
import { AuthError, AuthService } from "./auth.service";
import { createMailer, type Mailer } from "./mailer";
import { appUrl, type Config } from "./config";
import { HttpError } from "./errors";
import { verifyAccessToken } from "./security";
import { DebtsService } from "./debts.service";
import { ImportsService } from "./imports.service";
import { OnboardingService } from "./onboarding.service";
import { TransactionsService } from "./transactions.service";
import type { Services } from "./services";
import type { Env } from "./types";

/** Small in-memory fixed-window limiter for auth endpoints (per IP + route). */
function rateLimit(max: number, windowMs: number): MiddlewareHandler {
  const hits = new Map<string, { count: number; reset: number }>();
  return async (c, next) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    const k = `${ip}:${c.req.path}`;
    const now = Date.now();
    const h = hits.get(k);
    if (!h || h.reset < now) hits.set(k, { count: 1, reset: now + windowMs });
    else if (++h.count > max) return c.json({ error: "Terlalu banyak percobaan, coba lagi nanti" }, 429);
    await next();
  };
}

async function parse<T>(c: Context, schema: ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; res: Response }> {
  const body: unknown = await c.req.json().catch(() => null);
  const r = schema.safeParse(body);
  if (!r.success) {
    return { ok: false, res: c.json({ error: "Input tidak valid", issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400) };
  }
  return { ok: true, data: r.data };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** "YYYY-MM" in the app timezone (Asia/Jakarta). */
const currentMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date()).slice(0, 7);
const intParam = (v: string | undefined, def: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : def;
};

export function createApp(deps: { db: Db; config: Config; services: Services; mailer?: Mailer }) {
  const { db, config } = deps;
  const { market, dashboard, portfolio, holdings, assetCatalog } = deps.services;
  const mailer = deps.mailer ?? createMailer(config);
  const auth = new AuthService(db, config.JWT_SECRET, { requireEmailOtp: config.REQUIRE_EMAIL_OTP, mailer });
  const accountsSvc = new AccountsService(db);
  const adminSvc = new AdminService(db);
  const txSvc = new TransactionsService(db);
  const debtsSvc = new DebtsService(db);
  const importsSvc = new ImportsService(db);
  const onboardingSvc = new OnboardingService(db);
  const app = new Hono<Env>().basePath("/api");

  app.use("*", secureHeaders());
  app.use("*", cors({ origin: config.WEB_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean), allowHeaders: ["Content-Type", "Authorization"], allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"] }));

  app.get("/health", (c) => c.json({ status: "ok" }));

  /* ───── Auth (public) ───── */
  const limiter = rateLimit(20, 60_000);
  const ua = (c: Context) => c.req.header("user-agent")?.slice(0, 255) ?? null;

  app.post("/auth/register", limiter, async (c) => {
    const p = await parse(c, registerSchema);
    if (!p.ok) return p.res;
    const r = await auth.register(p.data, ua(c));
    // 202: the account is waiting for the emailed code, there are no tokens yet.
    return c.json(r, r.verificationRequired ? 202 : 201);
  });
  // Registration code (OTP): confirm it, or ask for a new one. Both are rate limited per address.
  app.post("/auth/verify", rateLimit(10, 15 * 60_000), async (c) => {
    const p = await parse(c, verifyEmailSchema);
    if (!p.ok) return p.res;
    return c.json(await auth.verifyEmail(p.data.email, p.data.code, ua(c)));
  });
  app.post("/auth/verify/resend", rateLimit(6, 10 * 60_000), async (c) => {
    const p = await parse(c, forgotPasswordSchema);
    if (!p.ok) return p.res;
    return c.json(await auth.resendVerification(p.data.email));
  });
  app.post("/auth/login", limiter, async (c) => {
    const p = await parse(c, loginSchema);
    if (!p.ok) return p.res;
    return c.json(await auth.login(p.data, ua(c)));
  });
  app.post("/auth/refresh", limiter, async (c) => {
    const p = await parse(c, refreshSchema);
    if (!p.ok) return p.res;
    return c.json({ tokens: await auth.refresh(p.data.refreshToken, ua(c)) });
  });
  // Password reset. The answer to /auth/forgot is always the same, whether or not the email has an account.
  const forgotLimiter = rateLimit(5, 15 * 60_000);
  app.post("/auth/forgot", forgotLimiter, async (c) => {
    const p = await parse(c, forgotPasswordSchema);
    if (!p.ok) return p.res;
    await auth.requestReset(p.data.email, mailer, appUrl(config));
    return c.json({ ok: true });
  });
  app.post("/auth/reset", limiter, async (c) => {
    const p = await parse(c, resetPasswordSchema);
    if (!p.ok) return p.res;
    await auth.resetPassword(p.data.token, p.data.password);
    return c.json({ ok: true });
  });
  app.post("/auth/logout", async (c) => {
    const p = await parse(c, refreshSchema);
    if (!p.ok) return p.res;
    await auth.logout(p.data.refreshToken);
    return c.body(null, 204);
  });

  /* ───── Authenticated ───── */
  // Identity always comes from the verified token; a workspaceId sent by clients is never trusted.
  const requireAuth: MiddlewareHandler<Env> = async (c, next) => {
    const h = c.req.header("authorization");
    const token = h?.startsWith("Bearer ") ? h.slice(7) : null;
    const claims = token ? await verifyAccessToken(config.JWT_SECRET, token) : null;
    if (!claims) return c.json({ error: "Tidak terautentikasi" }, 401);
    // The token is only proof of who this is. Whether the account may still be used, and what role it has, is read fresh
    // from the database on every request, so disabling an account or removing admin rights takes effect immediately.
    const [u] = await db.select({ role: users.role, disabledAt: users.disabledAt }).from(users).where(eq(users.id, claims.userId));
    if (!u) return c.json({ error: "Tidak terautentikasi" }, 401);
    // 401 (not 403) so the apps try a refresh, which is refused too, and sign the person out.
    if (u.disabledAt) return c.json({ error: "Akun ini dinonaktifkan. Hubungi admin.", code: "account_disabled" }, 401);
    c.set("userId", claims.userId);
    c.set("workspaceId", claims.workspaceId);
    c.set("role", u.role);
    await next();
  };
  const api = new Hono<Env>();
  api.use("*", requireAuth);

  api.get("/me", async (c) => {
    const user = await auth.me(c.get("userId"));
    if (!user) return c.json({ error: "Tidak terautentikasi" }, 401);
    return c.json({ user, workspaceId: c.get("workspaceId"), role: c.get("role") });
  });
  api.patch("/me", async (c) => {
    const p = await parse(c, updateProfileSchema);
    if (!p.ok) return p.res;
    return c.json({ user: await auth.updateName(c.get("userId"), p.data.name) });
  });
  // Checks the current password, so it is rate limited like sign-in (a stolen access token must not be a way to guess it).
  api.post("/me/password", rateLimit(10, 15 * 60_000), async (c) => {
    const p = await parse(c, changePasswordSchema);
    if (!p.ok) return p.res;
    await auth.changePassword(c.get("userId"), p.data.currentPassword, p.data.newPassword);
    return c.body(null, 204);
  });

  // Getting-started guide: progress is derived from the person's data, only "dismiss" is stored.
  api.get("/onboarding", async (c) => c.json(await onboardingSvc.status(c.get("workspaceId"), c.get("userId"))));
  api.post("/onboarding/dismiss", async (c) => {
    await onboardingSvc.dismiss(c.get("userId"));
    return c.body(null, 204);
  });

  api.get("/assets", async (c) => {
    const kind = c.req.query("kind");
    return c.json({ assets: await assetCatalog.list({ ...(isAssetKind(kind) ? { kind } : {}), q: c.req.query("q") ?? "", limit: intParam(c.req.query("limit"), 200, 300) }) });
  });
  // Remote (CoinGecko) lookups are rate limited so the shared provider quota cannot be exhausted by one user.
  const coinLimiter = rateLimit(40, 60_000);
  api.get("/assets/crypto/search", coinLimiter, async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    if (q.length < 2) return c.json({ coins: [], remote: true });
    return c.json(await assetCatalog.searchCrypto(q.slice(0, 40)));
  });
  api.post("/assets/crypto", coinLimiter, async (c) => {
    const p = await parse(c, addCryptoSchema);
    if (!p.ok) return p.res;
    return c.json({ asset: await assetCatalog.addCrypto(p.data.coingeckoId) }, 201);
  });

  api.get("/accounts", async (c) =>
    c.json({ accounts: await accountsSvc.list(c.get("workspaceId"), c.req.query("archived") === "true") }),
  );
  api.post("/accounts", async (c) => {
    const p = await parse(c, createAccountSchema);
    if (!p.ok) return p.res;
    return c.json({ account: await accountsSvc.create(c.get("workspaceId"), c.get("userId"), p.data) }, 201);
  });
  api.patch("/accounts/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) throw new HttpError(404, "Rekening tidak ditemukan");
    const p = await parse(c, updateAccountSchema);
    if (!p.ok) return p.res;
    return c.json({ account: await accountsSvc.update(c.get("workspaceId"), id, p.data) });
  });
  api.get("/accounts/:id/ledger", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) throw new HttpError(404, "Rekening tidak ditemukan");
    const assetId = c.req.query("assetId");
    if (assetId !== undefined && !UUID.test(assetId)) throw new HttpError(400, "Aset tidak valid");
    return c.json(await holdings.accountLedger(c.get("workspaceId"), id, {
      ...(assetId ? { assetId } : {}),
      limit: Math.max(intParam(c.req.query("limit"), 50, 200), 1),
      offset: intParam(c.req.query("offset"), 0, 100_000),
    }));
  });
  api.post("/accounts/:id/archive", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) throw new HttpError(404, "Rekening tidak ditemukan");
    await accountsSvc.archive(c.get("workspaceId"), id);
    return c.body(null, 204);
  });

  api.get("/transactions", async (c) =>
    c.json({ transactions: await txSvc.list(c.get("workspaceId"), intParam(c.req.query("limit"), 50, 100), intParam(c.req.query("offset"), 0, 100_000)) }),
  );
  api.post("/transactions", async (c) => {
    const p = await parse(c, createTransactionSchema);
    if (!p.ok) return p.res;
    const r = await txSvc.create(c.get("workspaceId"), c.get("userId"), p.data);
    return c.json({ transaction: { id: r.id }, replayed: r.replayed }, r.replayed ? 200 : 201);
  });
  api.get("/transactions/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) throw new HttpError(404, "Transaksi tidak ditemukan");
    return c.json({ transaction: await txSvc.getEditable(c.get("workspaceId"), id) });
  });
  // Full edit: reverses the live journal and posts a replacement (see TransactionsService.replace).
  api.put("/transactions/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) throw new HttpError(404, "Transaksi tidak ditemukan");
    const p = await parse(c, replaceTransactionSchema);
    if (!p.ok) return p.res;
    await txSvc.replace(c.get("workspaceId"), id, p.data);
    return c.body(null, 204);
  });
  api.patch("/transactions/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) throw new HttpError(404, "Transaksi tidak ditemukan");
    const p = await parse(c, updateTransactionSchema);
    if (!p.ok) return p.res;
    await txSvc.updateMetadata(c.get("workspaceId"), id, p.data);
    return c.body(null, 204);
  });
  api.post("/transactions/:id/void", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) throw new HttpError(404, "Transaksi tidak ditemukan");
    await txSvc.void(c.get("workspaceId"), id);
    return c.body(null, 204);
  });

  /* ───── CSV import: preview (read only), commit (all or nothing), undo a batch ───── */
  const importLimiter = rateLimit(30, 60_000);
  api.post("/imports/preview", importLimiter, async (c) => {
    const p = await parse(c, importPreviewSchema);
    if (!p.ok) return p.res;
    return c.json(await importsSvc.preview(c.get("workspaceId"), p.data));
  });
  api.post("/imports", importLimiter, async (c) => {
    const p = await parse(c, importCommitSchema);
    if (!p.ok) return p.res;
    const r = await importsSvc.commit(c.get("workspaceId"), c.get("userId"), p.data);
    return c.json({ batchKey: p.data.batchKey, ...r }, r.replayed ? 200 : 201);
  });
  api.post("/imports/:batchKey/undo", importLimiter, async (c) => {
    const key = c.req.param("batchKey");
    if (!/^[A-Za-z0-9-]{8,60}$/.test(key)) throw new HttpError(404, "Impor tidak ditemukan");
    return c.json(await importsSvc.undo(c.get("workspaceId"), key));
  });

  /* ───── Debts & receivables ───── */
  const debtId = (c: Context) => {
    const id = c.req.param("id") ?? "";
    if (!UUID.test(id)) throw new HttpError(404, "Utang/piutang tidak ditemukan");
    return id;
  };
  api.get("/debts", async (c) => c.json(await debtsSvc.list(c.get("workspaceId"))));
  api.post("/debts", async (c) => {
    const p = await parse(c, createDebtSchema);
    if (!p.ok) return p.res;
    const r = await debtsSvc.create(c.get("workspaceId"), c.get("userId"), p.data);
    return c.json({ debt: { id: r.id }, replayed: r.replayed }, r.replayed ? 200 : 201);
  });
  api.get("/debts/:id", async (c) => c.json(await debtsSvc.get(c.get("workspaceId"), debtId(c))));
  api.patch("/debts/:id", async (c) => {
    const id = debtId(c);
    const p = await parse(c, updateDebtSchema);
    if (!p.ok) return p.res;
    await debtsSvc.update(c.get("workspaceId"), id, p.data);
    return c.body(null, 204);
  });
  api.post("/debts/:id/payments", async (c) => {
    const id = debtId(c);
    const p = await parse(c, settleDebtSchema);
    if (!p.ok) return p.res;
    const r = await debtsSvc.settle(c.get("workspaceId"), c.get("userId"), id, p.data);
    return c.json({ transaction: { id: r.id }, replayed: r.replayed }, r.replayed ? 200 : 201);
  });
  api.post("/debts/:id/void", async (c) => {
    await debtsSvc.void(c.get("workspaceId"), debtId(c));
    return c.body(null, 204);
  });

  /* ───── Dashboard & market data ───── */
  // Viewing the dashboard also upserts today's net-worth snapshot (idempotent), so the chart fills as people use the app.
  api.get("/dashboard", async (c) => c.json(await dashboard.recordSnapshot(c.get("workspaceId"))));
  api.get("/dashboard/cashflow", async (c) =>
    c.json({ months: await dashboard.cashflow(c.get("workspaceId"), intParam(c.req.query("months"), 6, 24)) }),
  );
  api.get("/dashboard/cashflow/:kind", async (c) => {
    const kind = c.req.param("kind");
    if (kind !== "income" && kind !== "expense") throw new HttpError(404, "Jenis tidak ditemukan");
    const month = c.req.query("month") ?? currentMonth();
    if (!MONTH.test(month)) throw new HttpError(400, "Bulan harus berformat TTTT-BB");
    return c.json(await dashboard.cashflowDetail(c.get("workspaceId"), kind, month));
  });
  api.get("/dashboard/history", async (c) =>
    c.json({ points: await dashboard.history(c.get("workspaceId"), intParam(c.req.query("days"), 180, 3650)) }),
  );
  api.get("/holdings", async (c) => c.json(await holdings.byAsset(c.get("workspaceId"))));
  api.get("/portfolio", async (c) => c.json(await portfolio.summary(c.get("workspaceId"))));
  api.get("/prices", async (c) => c.json({ quotes: await market.latestQuotes() }));
  api.post("/market-data/refresh", rateLimit(6, 60_000), async (c) =>
    c.json(await market.refreshIfStale(60_000)),
  );

  /* ───── Admin (role "admin" only; the role is read from the database on every request) ───── */
  const admin = new Hono<Env>();
  admin.use("*", requireAuth);
  admin.use("*", async (c, next) => {
    if (c.get("role") !== "admin") return c.json({ error: "Hanya untuk admin" }, 403);
    await next();
  });
  const actorOf = async (c: Context<Env>) => {
    const me = await auth.me(c.get("userId"));
    if (!me) throw new HttpError(401, "Tidak terautentikasi");
    return { id: me.id, email: me.email };
  };
  const targetId = (c: Context<Env>) => {
    const id = c.req.param("id") ?? "";
    if (!UUID.test(id)) throw new HttpError(404, "Pengguna tidak ditemukan");
    return id;
  };
  admin.get("/users", async (c) => {
    const status = c.req.query("status");
    return c.json(await adminSvc.listUsers({
      q: c.req.query("q")?.slice(0, 100),
      status: (["active", "disabled", "unverified"] as const).includes(status as never) ? (status as UserStatus) : "all",
      limit: Math.max(1, intParam(c.req.query("limit"), 25, 100)),
      offset: intParam(c.req.query("offset"), 0, 1_000_000),
    }));
  });
  admin.get("/stats", async (c) => c.json(await adminSvc.stats()));
  admin.get("/audit", async (c) => c.json(await adminSvc.audit({ limit: Math.max(1, intParam(c.req.query("limit"), 30, 100)), offset: intParam(c.req.query("offset"), 0, 1_000_000) })));
  admin.post("/users/:id/disable", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown };
    const reason = typeof body.reason === "string" ? body.reason.slice(0, 200) : undefined;
    await adminSvc.setDisabled(await actorOf(c), targetId(c), true, reason);
    return c.body(null, 204);
  });
  admin.post("/users/:id/enable", async (c) => {
    await adminSvc.setDisabled(await actorOf(c), targetId(c), false);
    return c.body(null, 204);
  });
  admin.post("/users/:id/revoke-sessions", async (c) => c.json(await adminSvc.revokeSessions(await actorOf(c), targetId(c))));
  app.route("/admin", admin);

  app.route("/", api);

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, ...(err.extra ?? {}) }, err.status);
    if (err instanceof AuthError) return c.json({ error: err.message }, err.status);
    // Never log err.message: driver errors embed query params (password hashes, emails).
    console.error("Unhandled error:", err instanceof Error ? err.name : "unknown");
    return c.json({ error: "Terjadi kesalahan pada server" }, 500);
  });

  return app;
}
