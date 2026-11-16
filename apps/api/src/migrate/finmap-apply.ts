import { and, eq, inArray } from "drizzle-orm";
import { accounts, assets, transactions, users, workspaces, type Db } from "@bandha/db";
import { buildOpeningBalance, dec, valueHoldings } from "@bandha/ledger";
import { createDebtSchema, createTransactionSchema } from "@bandha/validation";
import { AccountsService } from "../accounts.service";
import { DebtsService } from "../debts.service";
import { functionalAsset, postJournal, systemAccountId } from "../ledger-store";
import { FakeFxProvider, FakeProvider } from "../market/fake";
import { MarketDataService } from "../market/market.service";
import { TransactionsService } from "../transactions.service";
import type { Plan, PlanAsset, Step } from "./finmap-plan";

export interface Failure { ref: string; what: string; error: string }
export interface Mismatch { account: string; asset: string; expected: string; actual: string }

export interface ApplyResult {
  userId: string;
  workspaceId: string;
  counts: { accounts: number; archived: number; steps: Record<string, number>; debts: number };
  assetsCreated: string[];
  /** Cost bases that FinMap did not have and that were estimated from today's price. */
  estimated: string[];
  failures: Failure[];
  mismatches: Mismatch[];
}

const TOLERANCE = dec("0.00000001");

const describe = (s: Step) => `${s.k} ${s.at.toISOString().slice(0, 10)}${s.description ? ` "${s.description.slice(0, 40)}"` : ""}`;
const messageOf = (e: unknown): string => {
  if (e && typeof e === "object" && "issues" in e && Array.isArray((e as { issues: unknown[] }).issues)) {
    return (e as { issues: Array<{ path: unknown[]; message: string }> }).issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  }
  return e instanceof Error ? e.message : String(e);
};

/**
 * Writes a plan into Bandha. `db` may be a transaction: the CLI runs everything inside one and decides at the end
 * whether to commit, so a dry run is the real thing minus the commit. Each step runs in its own savepoint, so one
 * failing step is reported and the rest still run. `db` MUST be a transaction (the savepoints rely on it).
 */
export async function applyPlan(db: Db, plan: Plan): Promise<ApplyResult> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, plan.user.email));
  if (existing) throw new Error(`${plan.user.email} sudah terdaftar di Bandha. Migrasi tidak menimpa atau menggabungkan akun yang sudah ada.`);

  // The person and their private ledger. A password hash from FinMap (argon2) is kept as is and upgraded on first login.
  const [user] = await db.insert(users).values({ email: plan.user.email, name: plan.user.name, passwordHash: plan.user.passwordHash ?? "!no-password-set", onboardingDismissedAt: new Date() }).returning({ id: users.id });
  const [ws] = await db.insert(workspaces).values({ ownerUserId: user!.id, name: plan.workspace.name, functionalCurrency: plan.workspace.currency }).returning({ id: workspaces.id });
  const userId = user!.id;
  const workspaceId = ws!.id;
  const fn = await functionalAsset(db as never, workspaceId);

  /* assets: reuse Bandha's catalog by symbol and kind, add what is missing (unpriced unless it has a CoinGecko id) */
  const assetId = new Map<string, string>();
  const assetCreated: string[] = [];
  for (const a of plan.assets) {
    const [found] = await db.select({ id: assets.id }).from(assets).where(and(eq(assets.symbol, a.symbol), eq(assets.kind, a.kind)));
    if (found) { assetId.set(a.fmId, found.id); continue; }
    const [created] = await db
      .insert(assets)
      .values({ symbol: a.symbol, name: a.name, kind: a.kind, decimals: Math.min(Math.max(a.decimals, 0), 18), providerRef: a.providerRef, unitDivisor: "1" })
      .returning({ id: assets.id });
    assetId.set(a.fmId, created!.id);
    assetCreated.push(`${a.symbol} (${a.kind}${a.providerRef ? ", harga dari CoinGecko" : ", tanpa sumber harga"})`);
  }
  const bAsset = (fmId: string) => {
    const id = assetId.get(fmId);
    if (!id) throw new Error(`Aset ${fmId} tidak dikenal`);
    return id;
  };
  const assetMeta = new Map<string, PlanAsset>(plan.assets.map((a) => [a.fmId, a]));

  /* accounts */
  const accountId = new Map<string, string>();
  for (const a of plan.accounts) {
    const [row] = await db
      .insert(accounts)
      .values({ workspaceId, name: a.name, kind: a.kind as never, brandKey: a.brandKey, includeInNetWorth: a.includeInNetWorth, createdAt: a.createdAt })
      .returning({ id: accounts.id });
    accountId.set(a.fmId, row!.id);
  }
  const bAccount = (fmId: string) => {
    const id = accountId.get(fmId);
    if (!id) throw new Error(`Rekening ${fmId} tidak dikenal`);
    return id;
  };

  /* today's prices, only used to give a cost to holdings that FinMap had no cost for */
  const market = new MarketDataService(db, new FakeProvider(), new FakeFxProvider());
  const quotes = await market.latestQuotes();
  const estimated: string[] = [];
  const valueToday = (fmAsset: string, quantity: string): string => {
    const meta = assetMeta.get(fmAsset);
    if (!meta) return "0";
    const v = valueHoldings([{ assetId: bAsset(fmAsset), symbol: meta.symbol, kind: meta.kind, quantity, isFunctional: false }], quotes, plan.workspace.currency, new Date(), Number.POSITIVE_INFINITY).rows[0]?.value;
    return v ? dec(v).toFixed() : "0";
  };

  const txSvc = new TransactionsService(db);
  const failures: Failure[] = [];
  const steps: Record<string, number> = {};
  const equity = () => systemAccountId(db as never, workspaceId, "equity");

  const postOpening = async (s: Extract<Step, { k: "opening" }>) => {
    const asset = bAsset(s.asset);
    let fa: string;
    if (asset === fn.id) fa = dec(s.quantity).toFixed();
    else if (s.unitCost) fa = dec(s.quantity).times(s.unitCost).toFixed();
    else {
      fa = valueToday(s.asset, s.quantity);
      estimated.push(`${assetMeta.get(s.asset)?.symbol} ${s.quantity} di ${plan.accounts.find((a) => a.fmId === s.account)?.name}: modal ${dec(fa).isZero() ? "0 (belum ada harga)" : `Rp ${fa} (harga hari ini)`}`);
    }
    await db.transaction(async (tx) => {
      const [t] = await tx.insert(transactions).values({ workspaceId, type: "opening", status: "posted", occurredAt: s.at, description: s.description, tags: ["dari-finmap"], createdByUserId: userId }).returning({ id: transactions.id });
      const entries = buildOpeningBalance({
        account: { accountId: bAccount(s.account), assetId: asset, quantity: s.quantity, functionalAmount: fa },
        equityAccountId: await equity(), equityAssetId: asset,
      });
      await postJournal(tx, { workspaceId, transactionId: t!.id, postedAt: s.at, entries });
    });
  };

  const run = async (s: Step, i: number) => {
    const key = `finmap:${s.ref}:${i}`.slice(0, 100);
    const meta = { description: s.description ?? undefined, occurredAt: s.at, tags: ["dari-finmap"], idempotencyKey: key };
    const fnValue = (asset: string, quantity: string, given: string) => {
      if (bAsset(asset) === fn.id) return undefined;
      if (!dec(given).isZero()) return given;
      const v = valueToday(asset, quantity);
      if (!dec(v).isZero()) estimated.push(`${s.k} ${assetMeta.get(asset)?.symbol} ${quantity}: nilai Rp ${v} (harga hari ini, FinMap tidak mencatat nilainya)`);
      return v;
    };
    switch (s.k) {
      case "opening": return postOpening(s);
      case "income": case "expense": {
        const fx = fnValue(s.asset, s.quantity, s.functionalAmount);
        const input = createTransactionSchema.parse({ type: s.k, accountId: bAccount(s.account), assetId: bAsset(s.asset), quantity: s.quantity, ...(fx ? { functionalAmount: fx } : {}), ...(s.category ? { category: s.category.slice(0, 60) } : {}), ...meta });
        await txSvc.create(workspaceId, userId, input);
        return;
      }
      case "transfer": {
        const input = createTransactionSchema.parse({ type: "transfer", fromAccountId: bAccount(s.from), toAccountId: bAccount(s.to), assetId: bAsset(s.asset), quantity: s.quantity, ...meta });
        await txSvc.create(workspaceId, userId, input);
        return;
      }
      case "buy": {
        const input = createTransactionSchema.parse({ type: "buy", accountId: bAccount(s.account), fundingAccountId: bAccount(s.funding), assetId: bAsset(s.asset), quantity: s.quantity, totalCost: s.totalCost, ...meta });
        await txSvc.create(workspaceId, userId, input);
        return;
      }
      case "sell": {
        const input = createTransactionSchema.parse({ type: "sell", accountId: bAccount(s.account), receivingAccountId: bAccount(s.receiving), assetId: bAsset(s.asset), quantity: s.quantity, proceeds: s.proceeds, ...meta });
        await txSvc.create(workspaceId, userId, input);
      }
    }
  };

  for (const [i, s] of plan.steps.entries()) {
    try {
      // Own savepoint (db is itself a transaction, so every statement below shares its connection): a failure rolls back only this step.
      await db.transaction(async () => { await run(s, i); });
      steps[s.k] = (steps[s.k] ?? 0) + 1;
    } catch (e) {
      failures.push({ ref: s.ref, what: describe(s), error: messageOf(e) });
    }
  }

  /* debts: existing contracts, no account, sized by what is left */
  const debtsSvc = new DebtsService(db);
  let debtCount = 0;
  for (const d of plan.debts) {
    try {
      await debtsSvc.create(workspaceId, userId, createDebtSchema.parse({ direction: d.direction, kind: d.kind, counterparty: d.counterparty, principal: d.principal, ...(d.dueDate ? { dueDate: d.dueDate } : {}), note: d.note }));
      debtCount++;
    } catch (e) {
      failures.push({ ref: d.ref, what: `utang "${d.counterparty}"`, error: messageOf(e) });
    }
  }

  /* archived accounts are archived last, because archived accounts cannot take transactions */
  const archivedIds = plan.accounts.filter((a) => a.archived).map((a) => bAccount(a.fmId));
  if (archivedIds.length > 0) await db.update(accounts).set({ archivedAt: new Date() }).where(inArray(accounts.id, archivedIds));

  /* reconcile: what Bandha now shows per account and asset versus what FinMap showed */
  const listed = await new AccountsService(db).list(workspaceId, true);
  const actual = new Map<string, string>();
  for (const a of listed) for (const b of a.balances) actual.set(`${a.id}:${b.assetId}`, b.quantity);
  const expected = new Map(plan.expected.map((e) => [`${bAccount(e.account)}:${bAsset(e.asset)}`, e.quantity]));
  const mismatches: Mismatch[] = [];
  const nameOfAccount = new Map(plan.accounts.map((a) => [bAccount(a.fmId), a.name]));
  const symbolOfAsset = new Map(plan.assets.map((a) => [bAsset(a.fmId), a.symbol]));
  for (const key of new Set([...expected.keys(), ...actual.keys()])) {
    const want = expected.get(key) ?? "0";
    const got = actual.get(key) ?? "0";
    if (dec(want).minus(dec(got)).abs().gt(TOLERANCE)) {
      const [acc, ast] = key.split(":") as [string, string];
      mismatches.push({ account: nameOfAccount.get(acc) ?? acc, asset: symbolOfAsset.get(ast) ?? ast, expected: dec(want).toFixed(), actual: dec(got).toFixed() });
    }
  }

  return {
    userId, workspaceId,
    counts: { accounts: plan.accounts.length, archived: archivedIds.length, steps, debts: debtCount },
    assetsCreated: assetCreated, estimated, failures, mismatches,
  };
}
