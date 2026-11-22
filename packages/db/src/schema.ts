import { sql } from "drizzle-orm";
import {
  boolean, date, index, integer, numeric, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// Money: PostgreSQL numeric, never floating point. Quantity precision is wide enough for crypto.
const qty = (name: string) => numeric(name, { precision: 38, scale: 18 });
const money = (name: string) => numeric(name, { precision: 38, scale: 8 });

export const assetKind = pgEnum("asset_kind", ["fiat", "crypto", "stock", "fund", "gold", "other"]);
export const accountKind = pgEnum("account_kind", [
  "cash", "bank", "ewallet", "exchange", "wallet", "brokerage", "gold", "property", "other",
  "income", "expense", "equity", "pnl", "liability", "receivable",
]);
export const txType = pgEnum("tx_type", [
  "income", "expense", "transfer", "buy", "sell", "opening", "adjustment",
  // Debts: borrow/lend open a contract, repay/collect settle part of it.
  "borrow", "lend", "repay", "collect",
]);
export const debtDirection = pgEnum("debt_direction", ["payable", "receivable"]);
export const txStatus = pgEnum("tx_status", ["draft", "scheduled", "posted", "void"]);
export const userRole = pgEnum("user_role", ["user", "admin"]);

/* ───────── Identity ───────── */

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    /** For an account that only ever signed in with Google this is a marker that matches no password, so a password cannot be used until one is set through "forgot password". */
    passwordHash: text("password_hash").notNull(),
    /** Google's stable account id ("sub"). Set the first time the person signs in with Google; the email alone is never used to recognise a returning Google user. */
    googleSub: text("google_sub"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    /** "admin" may use the /admin API (user list, disable accounts, statistics). Only ever set from the command line, never through the API. */
    role: userRole("role").notNull().default("user"),
    /** Set while an admin has disabled the account: no sign-in, no refresh, and every request with an existing access token is refused. */
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    /** Set when the person closes the "getting started" guide. Whether setup is done is derived from their data, never stored. */
    onboardingDismissedAt: timestamp("onboarding_dismissed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_unique").on(sql`lower(${t.email})`), uniqueIndex("users_google_sub_unique").on(t.googleSub)],
);

/**
 * What admins did (and when someone was made or removed as admin from the command line). Emails are copied in so the
 * log stays readable after an account is deleted.
 */
export const adminAudit = pgTable(
  "admin_audit",
  {
    id: id(),
    /** Null for actions taken from the command line. */
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorEmail: text("actor_email").notNull(),
    action: text("action").notNull(),
    targetUserId: uuid("target_user_id").references(() => users.id, { onDelete: "set null" }),
    targetEmail: text("target_email"),
    detail: text("detail"),
    createdAt: createdAt(),
  },
  (t) => [index("admin_audit_created_idx").on(t.createdAt)],
);

/** Refresh-token sessions with rotation. A reused token revokes its whole family. */
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    familyId: uuid("family_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sessions_token_hash_unique").on(t.tokenHash), index("sessions_family_idx").on(t.familyId), index("sessions_user_idx").on(t.userId)],
);

/** Single-use password reset tokens. Only the SHA-256 of the token is stored; the token itself exists only in the email. */
export const passwordResets = pgTable(
  "password_resets",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("password_resets_token_unique").on(t.tokenHash), index("password_resets_user_idx").on(t.userId, t.createdAt)],
);

/**
 * Email verification codes (6 digits) sent when someone registers. Only a hash of the code is stored, a wrong guess counts
 * against `attempts`, and a new code replaces the previous one (`usedAt` is set on the old row).
 */
export const emailVerifications = pgTable(
  "email_verifications",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("email_verifications_user_idx").on(t.userId, t.createdAt)],
);

/**
 * Workspace = internal data-isolation boundary. Every user gets exactly one automatically
 * and the UI never exposes it. All financial rows carry workspace_id.
 */
export const workspaces = pgTable(
  "workspaces",
  {
    id: id(),
    ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("Personal finance"),
    functionalCurrency: text("functional_currency").notNull().default("IDR"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("workspaces_owner_unique").on(t.ownerUserId)],
);

/* ───────── Asset catalog & market data ───────── */

export const assets = pgTable(
  "assets",
  {
    id: id(),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    kind: assetKind("kind").notNull(),
    /** Decimal places used for quantity of this asset (IDR 0, BTC 8, ...). */
    decimals: integer("decimals").notNull().default(2),
    providerRef: text("provider_ref"),
    /** Price of one unit = quote / unitDivisor. Gold is quoted per troy ounce but held in grams (31.1034768). */
    unitDivisor: numeric("unit_divisor", { precision: 38, scale: 18 }).notNull().default("1"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("assets_symbol_kind_unique").on(t.symbol, t.kind)],
);

/**
 * Latest price. Primary key is (asset, quote asset): a USD quote and an IDR quote for
 * the same asset are different rows and can never overwrite each other. (This was the
 * root cause of the FinMap USDT/USDC valuation bug.)
 */
export const marketQuotesLatest = pgTable(
  "market_quotes_latest",
  {
    assetId: uuid("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
    quoteAssetId: uuid("quote_asset_id").notNull().references(() => assets.id),
    price: numeric("price", { precision: 38, scale: 18 }).notNull(),
    source: text("source").notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.assetId, t.quoteAssetId] })],
);

export const marketQuotesHistory = pgTable(
  "market_quotes_history",
  {
    id: id(),
    assetId: uuid("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
    quoteAssetId: uuid("quote_asset_id").notNull().references(() => assets.id),
    price: numeric("price", { precision: 38, scale: 18 }).notNull(),
    source: text("source").notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  },
  (t) => [index("quotes_history_idx").on(t.assetId, t.quoteAssetId, t.asOf)],
);

/* ───────── Sources & accounts ───────── */

export const institutions = pgTable(
  "institutions",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("institutions_ws_idx").on(t.workspaceId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    kind: accountKind("kind").notNull(),
    /** Key into the shared brand catalog (bank, e-wallet, exchange logos). Null = guessed from the name. */
    brandKey: text("brand_key"),
    /** Optional single-asset restriction (e.g. a BTC wallet). Null = multi-asset. */
    assetId: uuid("asset_id").references(() => assets.id),
    includeInNetWorth: boolean("include_in_net_worth").notNull().default(true),
    /** System accounts (income/expense/equity counter-accounts) are hidden from the UI. */
    isSystem: boolean("is_system").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("accounts_ws_idx").on(t.workspaceId),
    // One system counter-account per kind per workspace (income / expense / equity).
    uniqueIndex("accounts_system_unique").on(t.workspaceId, t.kind).where(sql`${t.isSystem}`),
  ],
);

/* ───────── Debts & receivables ───────── */

/**
 * A contract header only. The outstanding amount is NEVER stored: it is the sum of the ledger entries on the
 * hidden liability / receivable account that belong to this debt's transactions, so it cannot drift from the books.
 */
export const debts = pgTable(
  "debts",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    /** payable = I owe someone (utang); receivable = someone owes me (piutang). */
    direction: debtDirection("direction").notNull(),
    /** personal | credit_card | mortgage | installment | other (free label, validated at the API). */
    kind: text("kind").notNull().default("personal"),
    counterparty: text("counterparty").notNull(),
    note: text("note"),
    /** Amount originally borrowed / lent, in the workspace functional currency. */
    principal: money("principal").notNull(),
    dueDate: date("due_date", { mode: "string" }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("debts_ws_idx").on(t.workspaceId, t.direction)],
);

/* ───────── Transactions & ledger ───────── */

export const transactions = pgTable(
  "transactions",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    type: txType("type").notNull(),
    status: txStatus("status").notNull().default("posted"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    description: text("description"),
    category: text("category"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    /** Set on the transactions that open or settle a debt. */
    debtId: uuid("debt_id").references(() => debts.id),
    /** Retry safety: same key in the same workspace returns the original result. */
    idempotencyKey: text("idempotency_key"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tx_ws_date_idx").on(t.workspaceId, t.occurredAt),
    index("tx_debt_idx").on(t.debtId),
    uniqueIndex("tx_idem_unique").on(t.workspaceId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
  ],
);

export const journals = pgTable(
  "journals",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id").references(() => transactions.id),
    /** Set when this journal reverses another (void / edit of a posted transaction). */
    reversesJournalId: uuid("reverses_journal_id"),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("journals_ws_idx").on(t.workspaceId, t.postedAt), index("journals_tx_idx").on(t.transactionId)],
);

/** Immutable: rows are only ever inserted. No updated_at on purpose. */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: id(),
    journalId: uuid("journal_id").notNull().references(() => journals.id),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    assetId: uuid("asset_id").notNull().references(() => assets.id),
    /** Signed: debit positive, credit negative. */
    quantity: qty("quantity").notNull(),
    /** Signed value in workspace functional currency. Journal sums to zero. */
    functionalAmount: money("functional_amount").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("entries_account_idx").on(t.accountId, t.assetId), index("entries_journal_idx").on(t.journalId)],
);

/** One row per workspace per day (Asia/Jakarta). Rebuildable projection used for the net-worth chart. */
export const netWorthSnapshots = pgTable(
  "net_worth_snapshots",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    netWorth: money("net_worth").notNull(),
    /** False when some holding had no price, so the value is a lower bound. */
    complete: boolean("complete").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.day] })],
);

/** Rebuildable projection of positions (quantity + weighted-average basis). */
export const positions = pgTable(
  "positions",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    assetId: uuid("asset_id").notNull().references(() => assets.id),
    quantity: qty("quantity").notNull(),
    /** Null = unknown basis (never coerced to zero). */
    costBasis: money("cost_basis"),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.accountId, t.assetId] })],
);
