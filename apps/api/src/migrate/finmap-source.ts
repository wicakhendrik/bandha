import type { Pool } from "pg";

/**
 * Reads one FinMap workspace. Only SELECTs run, inside a READ ONLY transaction, so the FinMap database cannot be
 * changed by this code even by mistake. Column names follow FinMap's Prisma schema (camelCase, quoted).
 */

export interface FmUser { id: string; email: string; passwordHash: string | null }
export interface FmWorkspace { id: string; name: string; currencyCode: string }
export interface FmAsset { id: string; type: string; symbol: string; name: string; decimals: number; fiatCurrencyCode: string | null; coingeckoId: string | null }
export interface FmSource { id: string; type: string; name: string; archivedAt: Date | null }
export interface FmAccount {
  id: string; financialSourceId: string; name: string; accountType: string; defaultAssetId: string | null;
  includeInNetWorth: boolean; openedAt: Date; archivedAt: Date | null;
}
export interface FmTransaction {
  id: string; transactionType: string; status: string; category: string | null; description: string | null;
  occurredAt: Date | null; createdAt: Date; snapshot: Record<string, unknown> | null; journalId: string | null;
}
export interface FmLedgerAccount { id: string; accountId: string | null; assetId: string | null; category: string; name: string }
export interface FmEntry { journalId: string; ledgerAccountId: string; assetId: string | null; direction: "debit" | "credit"; quantity: string | null; functionalAmount: string }
export interface FmDebt {
  id: string; name: string; contractType: string; direction: string; principalAmount: string; remainingBalance: string;
  interestRate: string | null; nextPaymentDate: Date | null; maturityDate: Date | null; status: string;
}
export interface FmBalance { accountId: string; assetId: string; quantity: string }

export interface FmData {
  owner: FmUser;
  workspace: FmWorkspace;
  /** People other than the owner who share this workspace. Bandha has one person per ledger, so they are not migrated. */
  otherMembers: number;
  assets: FmAsset[];
  sources: FmSource[];
  accounts: FmAccount[];
  /** Posted transactions, oldest first. */
  transactions: FmTransaction[];
  /** Transactions that do not affect balances (drafts, scheduled, voided), by status. */
  notPosted: Record<string, number>;
  ledgerAccounts: FmLedgerAccount[];
  /** Entries of the journals that are currently live for the posted transactions. */
  entries: FmEntry[];
  debts: FmDebt[];
  /** What FinMap itself shows as each account's balance (its balance projection). */
  balances: FmBalance[];
}

export interface FmOwner { email: string; workspaceName: string; accounts: number; transactions: number }

/** Everyone who owns a workspace in FinMap, for choosing whom to migrate. */
export async function listOwners(pool: Pool): Promise<FmOwner[]> {
  const res = await pool.query<{ email: string; name: string; accounts: string; transactions: string }>(`
    select u.email, w.name,
           (select count(*) from "Account" a where a."workspaceId" = w.id) as accounts,
           (select count(*) from "Transaction" t where t."workspaceId" = w.id and t.status = 'posted') as transactions
    from "WorkspaceMember" m
    join "User" u on u.id = m."userId"
    join "Workspace" w on w.id = m."workspaceId"
    where m.role = 'owner'
    order by u.email`);
  return res.rows.map((r) => ({ email: r.email, workspaceName: r.name, accounts: Number(r.accounts), transactions: Number(r.transactions) }));
}

export async function loadFinmap(pool: Pool, email: string): Promise<FmData> {
  const client = await pool.connect();
  try {
    await client.query("begin transaction read only");
    const q = async <T extends object>(sql: string, params: unknown[] = []): Promise<T[]> => (await client.query(sql, params)).rows as T[];

    const [owner] = await q<FmUser>(`select id, email, "passwordHash" from "User" where lower(email) = lower($1)`, [email]);
    if (!owner) throw new Error(`Pengguna ${email} tidak ditemukan di FinMap`);
    const [member] = await q<{ workspaceId: string }>(`select "workspaceId" from "WorkspaceMember" where "userId" = $1`, [owner.id]);
    if (!member) throw new Error(`Pengguna ${email} tidak punya workspace di FinMap`);
    const [workspace] = await q<FmWorkspace>(`select id, name, "currencyCode" from "Workspace" where id = $1`, [member.workspaceId]);
    if (!workspace) throw new Error("Workspace tidak ditemukan");
    const [others] = await q<{ n: string }>(`select count(*) as n from "WorkspaceMember" where "workspaceId" = $1 and "userId" <> $2`, [workspace.id, owner.id]);

    const assets = (await q<Omit<FmAsset, "decimals"> & { decimals: number }>(`
      select a.id, a.type, a.symbol, a.name, a.decimals, a."fiatCurrencyCode",
             (select pim."providerId" from "MarketInstrument" mi
                join "ProviderInstrumentMapping" pim on pim."instrumentId" = mi.id and pim.provider = 'coingecko'
               where mi."assetId" = a.id limit 1) as "coingeckoId"
      from "Asset" a`)).map((a) => ({ ...a, decimals: Number(a.decimals) }));

    const sources = await q<FmSource>(`select id, type, name, "archivedAt" from "FinancialSource" where "workspaceId" = $1`, [workspace.id]);
    const accounts = await q<FmAccount>(
      `select id, "financialSourceId", name, "accountType", "defaultAssetId", "includeInNetWorth", "openedAt", "archivedAt"
       from "Account" where "workspaceId" = $1 order by "openedAt", id`, [workspace.id]);

    const transactions = await q<FmTransaction>(`
      select t.id, t."transactionType", t.status, t.category, t.description, t."occurredAt", t."createdAt",
             r.snapshot, r."journalId"
      from "Transaction" t
      left join "TransactionRevision" r on r.id = t."currentRevisionId"
      where t."workspaceId" = $1 and t.status = 'posted'
      order by t."occurredAt" nulls last, t."createdAt", t.id`, [workspace.id]);
    const notPosted: Record<string, number> = {};
    for (const r of await q<{ status: string; n: string }>(`select status, count(*) as n from "Transaction" where "workspaceId" = $1 and status <> 'posted' group by status`, [workspace.id])) {
      notPosted[r.status] = Number(r.n);
    }

    const ledgerAccounts = await q<FmLedgerAccount>(`select id, "accountId", "assetId", category, name from "LedgerAccount" where "workspaceId" = $1`, [workspace.id]);
    const journalIds = transactions.flatMap((t) => (t.journalId ? [t.journalId] : []));
    const entries = journalIds.length === 0 ? [] : await q<FmEntry>(
      `select "journalId", "ledgerAccountId", "assetId", direction, quantity::text as quantity, "functionalAmount"::text as "functionalAmount"
       from "LedgerEntry" where "journalId" = any($1::uuid[])`, [journalIds]);

    const debts = await q<FmDebt>(
      `select id, name, "contractType", direction, "principalAmount"::text as "principalAmount", "remainingBalance"::text as "remainingBalance",
              "interestRate"::text as "interestRate", "nextPaymentDate", "maturityDate", status
       from "DebtContract" where "workspaceId" = $1 order by "createdAt"`, [workspace.id]);

    const balances = await q<FmBalance>(`select "accountId", "assetId", quantity::text as quantity from "AccountBalanceProjection" where "workspaceId" = $1`, [workspace.id]);

    await client.query("commit");
    return { owner, workspace, otherMembers: Number(others?.n ?? 0), assets, sources, accounts, transactions, notPosted, ledgerAccounts, entries, debts, balances };
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
