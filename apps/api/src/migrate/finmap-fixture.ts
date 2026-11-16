import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { hash as argon2Hash } from "@node-rs/argon2";

/**
 * Test support: builds a small FinMap database the way FinMap itself would have written it, quirks included, using
 * FinMap's real table and column names. The same seed runs against FinMap's real DDL (checked by hand) and against the
 * minimal DDL below (used by the automated tests, so they need no access to the FinMap repository).
 */

export const FINMAP_MIN_DDL = [
  `create table "User" (id uuid primary key default gen_random_uuid(), email text not null unique, "passwordHash" text, "platformRole" text default 'user', locale text default 'id', "createdAt" timestamptz default now(), "updatedAt" timestamptz default now())`,
  `create table "Workspace" (id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique, "currencyCode" text default 'IDR', locale text default 'id', timezone text default 'Asia/Jakarta', "createdAt" timestamptz default now(), "updatedAt" timestamptz default now())`,
  `create table "WorkspaceMember" (id uuid primary key default gen_random_uuid(), "workspaceId" uuid not null, "userId" uuid not null unique, role text default 'member', "joinedAt" timestamptz default now())`,
  `create table "Asset" (id uuid primary key default gen_random_uuid(), type text not null, symbol text not null, name text not null, decimals int default 2, "pricingMode" text default 'market', "fiatCurrencyCode" text unique, "isActive" boolean default true, "createdAt" timestamptz default now(), "updatedAt" timestamptz default now())`,
  `create table "MarketInstrument" (id uuid primary key default gen_random_uuid(), "assetId" uuid not null unique, "nativeId" text)`,
  `create table "ProviderInstrumentMapping" (id uuid primary key default gen_random_uuid(), "instrumentId" uuid not null, provider text not null, "providerId" text not null, "isPrimary" boolean default false, "createdAt" timestamptz default now())`,
  `create table "FinancialSource" (id uuid primary key default gen_random_uuid(), "workspaceId" uuid not null, type text not null, name text not null, "archivedAt" timestamptz, "createdAt" timestamptz default now(), "updatedAt" timestamptz default now())`,
  `create table "Account" (id uuid primary key default gen_random_uuid(), "workspaceId" uuid not null, "financialSourceId" uuid not null, name text not null, "accountType" text not null, "defaultAssetId" uuid, "syncMode" text default 'manual', "includeInNetWorth" boolean default true, "openedAt" timestamptz default now(), "archivedAt" timestamptz, "openingBalanceCompletedAt" timestamptz)`,
  `create table "LedgerAccount" (id uuid primary key default gen_random_uuid(), "workspaceId" uuid not null, "accountId" uuid, "assetId" uuid, category text not null, subtype text, name text not null, "systemKey" text unique, "isActive" boolean default true, "createdAt" timestamptz default now())`,
  `create table "Journal" (id uuid primary key default gen_random_uuid(), "workspaceId" uuid not null, "journalType" text not null, "reversedJournalId" uuid, "functionalCurrencyAssetId" uuid not null, description text, "occurredAt" timestamptz not null, "postedAt" timestamptz default now(), "createdAt" timestamptz default now())`,
  `create table "LedgerEntry" (id uuid primary key default gen_random_uuid(), "journalId" uuid not null, "ledgerAccountId" uuid not null, "assetId" uuid, direction text not null, quantity numeric(30,18), "functionalAmount" numeric(30,12) not null, "functionalCurrencyAssetId" uuid not null, "createdAt" timestamptz default now())`,
  `create table "Transaction" (id uuid primary key default gen_random_uuid(), "workspaceId" uuid not null, "transactionType" text not null, status text default 'draft', "currentRevisionId" uuid, category text, tags text[] default '{}', description text, "occurredAt" timestamptz, "postedAt" timestamptz, "createdAt" timestamptz default now(), "updatedAt" timestamptz default now())`,
  `create table "TransactionRevision" (id uuid primary key default gen_random_uuid(), "transactionId" uuid not null, "workspaceId" uuid not null, "revisionNumber" int not null, "journalId" uuid, snapshot jsonb not null, "createdAt" timestamptz default now())`,
  `create table "AccountBalanceProjection" (id uuid primary key default gen_random_uuid(), "workspaceId" uuid not null, "accountId" uuid not null, "assetId" uuid not null, quantity numeric(30,18) not null, "lastJournalId" uuid, version int default 1, "updatedAt" timestamptz default now())`,
  `create table "DebtContract" (id uuid primary key default gen_random_uuid(), "workspaceId" uuid not null, "accountId" uuid not null, name text not null, "contractType" text not null, direction text not null, "principalAmount" numeric(30,12) not null, "remainingBalance" numeric(30,12) not null, "interestRate" numeric(8,4), "interestType" text, "nextPaymentDate" timestamptz, "maturityDate" timestamptz, status text default 'active', "createdAt" timestamptz default now(), "updatedAt" timestamptz default now())`,
];

type Row = Record<string, unknown>;

export interface Fixture {
  email: string;
  password: string;
  ids: Record<string, string>;
  /** Balances FinMap shows per account (by key) and asset symbol, as its projection holds them. */
  balances: Record<string, Record<string, string>>;
}

export interface FixtureOptions { email?: string; gold?: boolean; passwordless?: boolean; otherMember?: boolean; badTransfer?: boolean; exotic?: string; exoticUnpriced?: boolean }

/** Prisma generates uuids in the client, so FinMap's real tables have no default for id: supply it. */
async function ins(c: PoolClient, table: string, row: Row): Promise<string> {
  const full: Row & { id: string } = { id: randomUUID(), ...row };
  const keys = Object.keys(full);
  await c.query(
    `insert into "${table}" (${keys.map((k) => `"${k}"`).join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")})`,
    keys.map((k) => full[k]),
  );
  return full.id;
}

const D = (s: string) => new Date(s);

export async function seedFinmap(c: PoolClient, opts: FixtureOptions = {}): Promise<Fixture> {
  const email = opts.email ?? "wicak@contoh.id";
  const password = "finmap-pass-123";
  const ids: Record<string, string> = {};
  const bal: Record<string, Record<string, string>> = {};
  const now = new Date();
  const projection = new Map<string, number>(); // "accountKey:SYMBOL" -> quantity (plain numbers are fine for the small fixture amounts)
  const add = (acc: string, sym: string, q: number) => projection.set(`${acc}:${sym}`, (projection.get(`${acc}:${sym}`) ?? 0) + q);

  /* people, workspace */
  ids["user"] = await ins(c, "User", { email, passwordHash: opts.passwordless ? null : await argon2Hash(password), updatedAt: now });
  ids["ws"] = await ins(c, "Workspace", { name: "Keuangan Wicak", slug: `ws-${Math.random().toString(36).slice(2, 10)}`, currencyCode: "IDR", updatedAt: now });
  await ins(c, "WorkspaceMember", { workspaceId: ids["ws"], userId: ids["user"], role: "owner" });
  if (opts.otherMember) {
    const other = await ins(c, "User", { email: `istri-${email}`, passwordHash: null, updatedAt: now });
    await ins(c, "WorkspaceMember", { workspaceId: ids["ws"], userId: other, role: "member" });
  }
  const ws = ids["ws"]!;

  /* assets */
  const asset = async (key: string, type: string, symbol: string, name: string, decimals: number, extra: Row = {}, coingecko?: string) => {
    // FinMap's asset catalog is shared by every workspace, so a second person reuses what the first one created.
    const found = await c.query(`select id from "Asset" where type = $1 and symbol = $2`, [type, symbol]);
    if (found.rows[0]) { ids[key] = (found.rows[0] as { id: string }).id; return; }
    ids[key] = await ins(c, "Asset", { type, symbol, name, decimals, updatedAt: now, ...extra });
    if (coingecko) {
      const inst = await ins(c, "MarketInstrument", { assetId: ids[key] });
      await ins(c, "ProviderInstrumentMapping", { instrumentId: inst, provider: "coingecko", providerId: coingecko, isPrimary: true });
    }
  };
  await asset("IDR", "fiat", "IDR", "Indonesian Rupiah", 0, { fiatCurrencyCode: "IDR" });
  await asset("USD", "fiat", "USD", "US Dollar", 2, { fiatCurrencyCode: "USD" });
  await asset("BTC", "crypto", "BTC", "Bitcoin", 8, {}, "bitcoin");
  await asset("PEPE", "crypto", "PEPE", "Pepe", 8, {}, "pepe");
  if (opts.gold) await asset("XAU", "commodity", "XAU", "Gold", 2);
  // a coin Bandha has never heard of, to exercise asset creation
  if (opts.exotic) await asset(opts.exotic, "crypto", opts.exotic, `Coin ${opts.exotic}`, 8, {}, opts.exoticUnpriced ? undefined : opts.exotic.toLowerCase());
  const fn = ids["IDR"]!;

  /* sources and accounts */
  const source = async (key: string, type: string, name: string, extra: Row = {}) => { ids[key] = await ins(c, "FinancialSource", { workspaceId: ws, type, name, updatedAt: now, ...extra }); };
  await source("bca", "bank", "BCA");
  await source("indodax", "exchange", "Indodax");
  await source("gopay", "wallet", "GoPay");
  await source("kk", "bank", "Mandiri");
  await source("lama", "bank", "Bank Lama", { archivedAt: D("2026-06-01T00:00:00Z") });

  const account = async (key: string, src: string, name: string, accountType: string, defaultAsset: string | null, extra: Row = {}) => {
    ids[key] = await ins(c, "Account", {
      workspaceId: ws, financialSourceId: ids[src], name, accountType, defaultAssetId: defaultAsset ? ids[defaultAsset] : null,
      openedAt: D("2026-01-05T03:00:00Z"), openingBalanceCompletedAt: D("2026-01-05T03:00:00Z"), ...extra,
    });
  };
  await account("tab", "bca", "Tabungan", "savings", "IDR");
  await account("idx", "indodax", "Indodax", "exchange", "BTC");
  await account("gp", "gopay", "GoPay", "wallet", "IDR");
  await account("cc", "kk", "Kartu Kredit", "credit", "IDR", { includeInNetWorth: false });
  await account("old", "lama", "Tabungan Lama", "savings", "IDR", { archivedAt: D("2026-06-01T00:00:00Z") });

  /* ledger plumbing the way FinMap's PostingService creates it */
  const ledgerOf = new Map<string, string>();
  const ledger = async (category: string, name: string, key: string, acc?: string, ast?: string) => {
    const hit = ledgerOf.get(key);
    if (hit) return hit;
    const id = await ins(c, "LedgerAccount", { workspaceId: ws, accountId: acc ? ids[acc] : null, assetId: ast ? ids[ast] : null, category, name, systemKey: `${key}:${ws}` });
    ledgerOf.set(key, id);
    return id;
  };
  const assetLedger = (acc: string, ast: string) => ledger("asset", `Asset:${acc}:${ast}`, `asset-ledger:${acc}:${ast}`, acc, ast);

  type E = { l: string; ast: string | null; dir: "debit" | "credit"; q: number | null; fa: number };
  const journal = async (type: "posting" | "reversal", at: string, desc: string, entries: E[], reverses?: string) => {
    const j = await ins(c, "Journal", { workspaceId: ws, journalType: type, reversedJournalId: reverses ?? null, functionalCurrencyAssetId: fn, description: desc, occurredAt: D(at) });
    for (const e of entries) {
      await ins(c, "LedgerEntry", { journalId: j, ledgerAccountId: e.l, assetId: e.ast ? ids[e.ast] : null, direction: e.dir, quantity: e.q === null ? null : String(e.q), functionalAmount: String(e.fa), functionalCurrencyAssetId: fn });
    }
    return j;
  };
  const transaction = async (type: string, at: string, snapshot: Row, journalId: string | null, extra: Row = {}) => {
    const t = await ins(c, "Transaction", { workspaceId: ws, transactionType: type, status: "posted", occurredAt: D(at), postedAt: D(at), category: null, description: null, updatedAt: now, ...extra });
    const r = await ins(c, "TransactionRevision", { transactionId: t, workspaceId: ws, revisionNumber: 1, journalId, snapshot: JSON.stringify(snapshot) });
    await c.query(`update "Transaction" set "currentRevisionId" = $1 where id = $2`, [r, t]);
    return t;
  };

  /* openings (equity counter-entry, FinMap's own conventions) */
  const equity = await ledger("equity", "Equity:OpeningBalance", `equity:opening-balance`);
  const opening = async (acc: string, items: Array<{ ast: string; q: number; unit?: number }>) => {
    const entries: E[] = [];
    for (const it of items) {
      const fa = ast(it.ast) === "fiat" ? it.q : it.unit ? it.q * it.unit : 0;
      entries.push({ l: await assetLedger(acc, it.ast), ast: it.ast, dir: "debit", q: it.q, fa }, { l: equity, ast: null, dir: "credit", q: it.q, fa });
      add(acc, it.ast, it.q);
    }
    const j = await journal("posting", "2026-01-05T03:00:00Z", `Opening balance for ${acc}`, entries);
    await transaction("opening_balance", "2026-01-05T03:00:00Z", {
      transactionType: "opening_balance", accountId: ids[acc], items: items.map((i) => ({ assetId: ids[i.ast], quantity: String(i.q), ...(i.unit ? { costBasisFunctional: String(i.unit) } : {}) })),
    }, j, { description: `Opening balance for ${acc}`, category: "Opening balance" });
  };
  const ast = (k: string) => (k === "IDR" || k === "USD" ? "fiat" : "other");
  await opening("tab", [{ ast: "IDR", q: 10_000_000 }]);
  await opening("idx", [{ ast: "BTC", q: 0.5, unit: 500_000_000 }, { ast: "PEPE", q: 1_000_000 }, { ast: "USD", q: 100 }, ...(opts.exotic ? [{ ast: opts.exotic, q: 7 }] : [])]);
  await opening("gp", [{ ast: "IDR", q: 200_000 }]);
  if (opts.gold) await opening("tab", [{ ast: "XAU", q: 2, unit: 3_000_000 }]);

  /* commands, as FinMap stores them in the revision snapshot */
  const base = { tags: [], status: "posted" };
  const income = async (acc: string, at: string, q: number, category: string, description: string) => {
    const j = await journal("posting", at, description, [
      { l: await assetLedger(acc, "IDR"), ast: "IDR", dir: "debit", q, fa: q }, { l: await ledger("income", `Income:${category}`, `income:${category}`), ast: "IDR", dir: "credit", q, fa: q },
    ]);
    add(acc, "IDR", q);
    return transaction("income", at, { ...base, transactionType: "income", accountId: ids[acc], assetId: fn, category, quantity: String(q), functionalAmount: String(q), description, occurredAt: at }, j, { category, description });
  };
  const expense = async (acc: string, at: string, q: number, category: string, description: string) => {
    const j = await journal("posting", at, description, [
      { l: await ledger("expense", `Expense:${category}`, `expense:${category}`), ast: "IDR", dir: "debit", q, fa: q }, { l: await assetLedger(acc, "IDR"), ast: "IDR", dir: "credit", q, fa: q },
    ]);
    add(acc, "IDR", -q);
    return transaction("expense", at, { ...base, transactionType: "expense", accountId: ids[acc], assetId: fn, category, quantity: String(q), functionalAmount: String(q), description, occurredAt: at }, j, { category, description });
  };

  await income("tab", "2026-02-01T05:00:00Z", 8_000_000, "Gaji", "Gaji Februari");
  await expense("gp", "2026-02-03T05:00:00Z", 150_000, "Makan", "Makan siang");

  // transfer with an IDR fee
  {
    const at = "2026-02-05T05:00:00Z";
    const src = await assetLedger("tab", "IDR");
    const dst = await assetLedger("gp", "IDR");
    const j = await journal("posting", at, "Transfer ke GoPay", [
      { l: src, ast: "IDR", dir: "credit", q: 500_000, fa: 500_000 }, { l: dst, ast: "IDR", dir: "debit", q: 500_000, fa: 500_000 },
      { l: src, ast: "IDR", dir: "credit", q: 2_500, fa: 2_500 }, { l: await ledger("expense", "Expense:TransferFee", "expense:transfer-fee"), ast: "IDR", dir: "debit", q: 2_500, fa: 2_500 },
    ]);
    add("tab", "IDR", -502_500); add("gp", "IDR", 500_000);
    await transaction("transfer", at, { ...base, transactionType: "transfer", sourceAccountId: ids["tab"], destinationAccountId: ids["gp"], assetId: fn, quantity: "500000", functionalAmount: "500000", feeQuantity: "2500", feeFunctionalAmount: "2500", feeAssetId: fn, occurredAt: at }, j, { description: "Transfer ke GoPay" });
  }

  // conversion IDR -> BTC (a purchase). FinMap's quirk: the fee reaches the account balance but not an asset ledger entry.
  {
    const at = "2026-02-10T05:00:00Z";
    const clearing = await ledger("clearing", "Clearing:Conversion", "clearing:conversion");
    const j = await journal("posting", at, "Beli BTC", [
      { l: await assetLedger("tab", "IDR"), ast: "IDR", dir: "credit", q: 5_000_000, fa: 5_000_000 }, { l: clearing, ast: "IDR", dir: "debit", q: 5_000_000, fa: 5_000_000 },
      { l: clearing, ast: "BTC", dir: "credit", q: 0.01, fa: 5_000_000 }, { l: await assetLedger("idx", "BTC"), ast: "BTC", dir: "debit", q: 0.01, fa: 5_000_000 },
      { l: clearing, ast: "IDR", dir: "debit", q: 7_500, fa: 7_500 }, { l: await ledger("expense", "Expense:ConversionFee", "expense:conversion-fee"), ast: "IDR", dir: "credit", q: 7_500, fa: 7_500 },
    ]);
    add("tab", "IDR", -5_000_000 - 7_500); add("idx", "BTC", 0.01);
    await transaction("conversion", at, {
      ...base, transactionType: "conversion", sourceAccountId: ids["tab"], sourceAssetId: fn, sourceQuantity: "5000000", sourceFunctionalAmount: "5000000",
      destinationAccountId: ids["idx"], destinationAssetId: ids["BTC"], destinationQuantity: "0.01", destinationFunctionalAmount: "5000000",
      feeQuantity: "7500", feeFunctionalAmount: "7500", feeAssetId: fn, occurredAt: at,
    }, j, { description: "Beli BTC" });
  }

  // conversion BTC -> IDR (a sale)
  {
    const at = "2026-03-01T05:00:00Z";
    const clearing = await ledger("clearing", "Clearing:Conversion", "clearing:conversion");
    const j = await journal("posting", at, "Jual BTC", [
      { l: await assetLedger("idx", "BTC"), ast: "BTC", dir: "credit", q: 0.1, fa: 55_000_000 }, { l: clearing, ast: "BTC", dir: "debit", q: 0.1, fa: 55_000_000 },
      { l: clearing, ast: "IDR", dir: "credit", q: 55_000_000, fa: 55_000_000 }, { l: await assetLedger("tab", "IDR"), ast: "IDR", dir: "debit", q: 55_000_000, fa: 55_000_000 },
    ]);
    add("idx", "BTC", -0.1); add("tab", "IDR", 55_000_000);
    await transaction("conversion", at, {
      ...base, transactionType: "conversion", sourceAccountId: ids["idx"], sourceAssetId: ids["BTC"], sourceQuantity: "0.1", sourceFunctionalAmount: "55000000",
      destinationAccountId: ids["tab"], destinationAssetId: fn, destinationQuantity: "55000000", destinationFunctionalAmount: "55000000", occurredAt: at,
    }, j, { description: "Jual BTC" });
  }

  // an income that was later EDITED: the old journal was reversed and replaced by a raw-entries revision (no command fields)
  {
    const at = "2026-03-05T05:00:00Z";
    const tabIdr = await assetLedger("tab", "IDR");
    const inc = await ledger("income", "Income:Freelance", "income:Freelance");
    const first = await journal("posting", at, "Proyek", [{ l: tabIdr, ast: "IDR", dir: "debit", q: 1_000_000, fa: 1_000_000 }, { l: inc, ast: "IDR", dir: "credit", q: 1_000_000, fa: 1_000_000 }]);
    await journal("reversal", "2026-03-06T05:00:00Z", "Reversal", [{ l: tabIdr, ast: "IDR", dir: "credit", q: 1_000_000, fa: 1_000_000 }, { l: inc, ast: "IDR", dir: "debit", q: 1_000_000, fa: 1_000_000 }], first);
    const second = await journal("posting", at, "Proyek (koreksi)", [{ l: tabIdr, ast: "IDR", dir: "debit", q: 1_250_000, fa: 1_250_000 }, { l: inc, ast: "IDR", dir: "credit", q: 1_250_000, fa: 1_250_000 }]);
    add("tab", "IDR", 1_250_000);
    const t = await transaction("income", at, { transactionType: "income", description: "Proyek (koreksi)", entries: [] }, second, { category: "Freelance", description: "Proyek (koreksi)" });
    await ins(c, "TransactionRevision", { transactionId: t, workspaceId: ws, revisionNumber: 0, journalId: first, snapshot: "{}" });
  }

  // FinMap let people skip its balance check, so it holds a transfer of more BTC than the account had; Bandha refuses it
  if (opts.badTransfer) {
    const at = "2026-03-08T05:00:00Z";
    const src = await assetLedger("idx", "BTC");
    const dst = await assetLedger("tab", "BTC");
    const j = await journal("posting", at, "Pindah BTC", [{ l: src, ast: "BTC", dir: "credit", q: 5, fa: 1 }, { l: dst, ast: "BTC", dir: "debit", q: 5, fa: 1 }]);
    add("idx", "BTC", -5); add("tab", "BTC", 5);
    await transaction("transfer", at, { ...base, transactionType: "transfer", sourceAccountId: ids["idx"], destinationAccountId: ids["tab"], assetId: ids["BTC"], quantity: "5", functionalAmount: "1", occurredAt: at }, j, { description: "Pindah BTC" });
  }

  // drafts / scheduled / void never touched balances
  for (const status of ["draft", "scheduled", "void"]) {
    await ins(c, "Transaction", { workspaceId: ws, transactionType: "expense", status, description: `catatan ${status}`, occurredAt: D("2026-03-10T05:00:00Z"), updatedAt: now });
  }

  // a dividend: a type Bandha cannot take yet
  await transaction("dividend", "2026-03-12T05:00:00Z", { transactionType: "dividend" }, null, { description: "Dividen" });

  /* debts */
  const debt = (name: string, type: string, direction: string, principal: number, remaining: number, status: string, extra: Row = {}) =>
    ins(c, "DebtContract", { workspaceId: ws, accountId: ids["cc"], name, contractType: type, direction, principalAmount: String(principal), remainingBalance: String(remaining), status, updatedAt: now, ...extra });
  await debt("KPR BCA", "mortgage", "liability", 100_000_000, 80_000_000, "active", { interestRate: "7.5", nextPaymentDate: D("2026-12-05T00:00:00Z") });
  await debt("Pinjaman Budi", "receivable", "receivable", 500_000, 500_000, "active");
  await debt("Cicilan HP", "installment", "liability", 3_000_000, 0, "paid_off");

  /* FinMap's balance projection: what its screens show */
  const sym = (k: string) => k;
  for (const [key, q] of projection) {
    const [acc, a] = key.split(":") as [string, string];
    await ins(c, "AccountBalanceProjection", { workspaceId: ws, accountId: ids[acc], assetId: ids[a], quantity: String(q) });
    (bal[acc] ??= {})[sym(a)] = String(q);
  }

  return { email, password, ids, balances: bal };
}
