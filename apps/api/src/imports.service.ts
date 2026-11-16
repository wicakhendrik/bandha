import { and, count, eq, like, sql } from "drizzle-orm";
import { journals, ledgerEntries, transactions, type Db } from "@bandha/db";
import { buildExpense, buildIncome, dec, roundMoney, type Entry } from "@bandha/ledger";
import type { ImportCommitInput, ImportPreviewInput } from "@bandha/validation";
import { detectMapping, extractRows, findHeaderRow, parseCsv, type ImportRow, type Mapping } from "./csv";
import { HttpError } from "./errors";
import { assertUsableAccounts, functionalAsset, LIVE_J, systemAccountId } from "./ledger-store";
import { TransactionsService } from "./transactions.service";
import { isUniqueViolation } from "./types";

export const MAX_IMPORT_ROWS = 2000;
const CHUNK = 500;

/** Lower case, single spaces: "KOPI  Kenangan" and "kopi kenangan" are the same payee. */
const normText = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200);
const occurredAt = (r: { day: string; time?: string | null }) => new Date(`${r.day}T${r.time ?? "12:00"}:00+07:00`);

export class ImportsService {
  private readonly txs: TransactionsService;
  constructor(private readonly db: Db) {
    this.txs = new TransactionsService(db);
  }

  /**
   * Reads a statement and says what would happen, writing nothing. Rows already present in the account (same day, amount
   * and description) are flagged as duplicates. A statement imported twice therefore shows every row as a duplicate, while
   * two genuine identical purchases in one file are not mistaken for each other (matching is by count).
   */
  async preview(workspaceId: string, input: ImportPreviewInput) {
    await this.db.transaction((tx) => assertUsableAccounts(tx, workspaceId, [input.accountId]));

    const { delimiter, rows: grid } = parseCsv(input.csv);
    if (grid.length === 0) throw new HttpError(400, "File CSV kosong atau tidak bisa dibaca");
    const headerRow = findHeaderRow(grid);
    const headers = grid[headerRow]!;
    const data = grid.slice(headerRow + 1);
    if (data.length > MAX_IMPORT_ROWS) throw new HttpError(400, `File berisi ${data.length} baris. Maksimal ${MAX_IMPORT_ROWS} per impor, pecah file menjadi beberapa bagian`);

    const mapping: Mapping = input.mapping ?? detectMapping(headers);
    for (const v of Object.values(mapping)) if (v !== null && v >= headers.length) throw new HttpError(400, "Kolom yang dipilih tidak ada di file");
    const needsMapping = mapping.date === null || (mapping.amount === null && mapping.debit === null && mapping.credit === null);
    const sample = data.slice(0, 3);
    if (needsMapping) {
      return { delimiter, headers, mapping, needsMapping, dateOrder: input.dateOrder, sample, rows: [], problems: [], summary: this.summary([], [], 0, data.length) };
    }

    const { rows, problems, skipped } = extractRows(data, headerRow + 2, mapping, input.dateOrder);
    const duplicate = await this.duplicates(workspaceId, input.accountId, rows);
    const out = rows.map((r, i) => ({ ...r, duplicate: duplicate[i]! }));
    return { delimiter, headers, mapping, needsMapping, dateOrder: input.dateOrder, sample, rows: out, problems, summary: this.summary(out, problems, skipped, data.length) };
  }

  private summary(rows: Array<ImportRow & { duplicate: boolean }>, problems: unknown[], skipped: number, records: number) {
    const fresh = rows.filter((r) => !r.duplicate);
    const sum = (t: ImportRow["type"]) => fresh.filter((r) => r.type === t).reduce((a, r) => a.plus(dec(r.amount)), dec("0")).toFixed();
    return {
      records, readable: rows.length, duplicates: rows.length - fresh.length, problems: problems.length, skipped,
      income: sum("income"), expense: sum("expense"),
    };
  }

  /** For each row: does the account already hold an identical transaction? Existing ones are consumed one per matching row. */
  private async duplicates(workspaceId: string, accountId: string, rows: ImportRow[]): Promise<boolean[]> {
    if (rows.length === 0) return [];
    const days = rows.map((r) => r.day).sort();
    const from = new Date(`${days[0]}T00:00:00+07:00`);
    const to = new Date(new Date(`${days[days.length - 1]}T00:00:00+07:00`).getTime() + 86_400_000);
    const fn = await this.db.transaction((tx) => functionalAsset(tx, workspaceId));
    const res = await this.db.execute(sql`
      select to_char(t.occurred_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD') as day, e.quantity::text as q, coalesce(t.description, '') as d
      from ledger_entries e
      join journals j on j.id = e.journal_id
      join transactions t on t.id = j.transaction_id
      where e.workspace_id = ${workspaceId} and e.account_id = ${accountId} and e.asset_id = ${fn.id}
        and t.status = 'posted' and ${LIVE_J} and t.occurred_at >= ${from} and t.occurred_at < ${to}`);
    const pool = new Map<string, number>();
    for (const r of res.rows as Array<{ day: string; q: string; d: string }>) {
      const k = `${r.day}|${dec(r.q).toFixed()}|${normText(r.d)}`;
      pool.set(k, (pool.get(k) ?? 0) + 1);
    }
    return rows.map((r) => {
      const k = `${r.day}|${(r.type === "expense" ? dec(r.amount).neg() : dec(r.amount)).toFixed()}|${normText(r.description)}`;
      const left = pool.get(k) ?? 0;
      if (left > 0) { pool.set(k, left - 1); return true; }
      return false;
    });
  }

  /**
   * Posts the rows as income / expense in the functional currency (IDR), all in one database transaction: either every
   * row lands or none does. Inserts are batched, so 2000 rows take a handful of queries, not thousands. Each transaction
   * carries the idempotency key `<batchKey>:<n>`, which makes a repeated request a no-op and lets `undo` find the batch.
   */
  async commit(workspaceId: string, userId: string, input: ImportCommitInput): Promise<{ imported: number; replayed: boolean }> {
    const replay = async () => ({ imported: await this.countBatch(workspaceId, input.batchKey), replayed: true });
    const [first] = await this.db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.workspaceId, workspaceId), eq(transactions.idempotencyKey, `${input.batchKey}:0`)));
    if (first) return replay();

    try {
      return await this.db.transaction(async (tx) => {
        await assertUsableAccounts(tx, workspaceId, [input.accountId]);
        const fn = await functionalAsset(tx, workspaceId);
        const incomeId = await systemAccountId(tx, workspaceId, "income");
        const expenseId = await systemAccountId(tx, workspaceId, "expense");

        const prepared = input.rows.map((r, i) => {
          const amount = roundMoney(dec(r.amount).toFixed());
          if (dec(amount).isZero()) throw new HttpError(400, `Baris ${i + 1}: jumlah terlalu kecil`);
          const cash = { accountId: input.accountId, assetId: fn.id, quantity: amount, functionalAmount: amount };
          const entries: Entry[] = r.type === "income"
            ? buildIncome({ cash, incomeAccountId: incomeId, incomeAssetId: fn.id })
            : buildExpense({ cash, expenseAccountId: expenseId, expenseAssetId: fn.id });
          return { key: `${input.batchKey}:${i}`, row: r, entries, at: occurredAt(r) };
        });

        for (let start = 0; start < prepared.length; start += CHUNK) {
          const chunk = prepared.slice(start, start + CHUNK);
          const inserted = await tx
            .insert(transactions)
            .values(chunk.map((p) => ({
              workspaceId, type: p.row.type, status: "posted" as const, occurredAt: p.at, description: p.row.description || null,
              category: p.row.category || null, tags: ["import"], idempotencyKey: p.key, createdByUserId: userId,
            })))
            .returning({ id: transactions.id, key: transactions.idempotencyKey });
          const idByKey = new Map(inserted.map((t) => [t.key, t.id]));

          const js = await tx
            .insert(journals)
            .values(chunk.map((p) => ({ workspaceId, transactionId: idByKey.get(p.key)!, postedAt: p.at })))
            .returning({ id: journals.id, transactionId: journals.transactionId });
          const journalByTx = new Map(js.map((j) => [j.transactionId, j.id]));

          await tx.insert(ledgerEntries).values(
            chunk.flatMap((p) => {
              const journalId = journalByTx.get(idByKey.get(p.key)!)!;
              return p.entries.map((e) => ({ journalId, workspaceId, accountId: e.accountId, assetId: e.assetId, quantity: e.quantity, functionalAmount: e.functionalAmount }));
            }),
          );
        }
        return { imported: prepared.length, replayed: false };
      });
    } catch (err) {
      // A concurrent request with the same batch key won the race: report its result.
      if (isUniqueViolation(err)) return replay();
      throw err;
    }
  }

  private async countBatch(workspaceId: string, batchKey: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(transactions)
      .where(and(eq(transactions.workspaceId, workspaceId), like(transactions.idempotencyKey, `${batchKey}:%`), eq(transactions.status, "posted")));
    return row?.n ?? 0;
  }

  /** Voids every transaction of one import batch (reversal journals, history kept). */
  async undo(workspaceId: string, batchKey: string): Promise<{ voided: number }> {
    const rows = await this.db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.workspaceId, workspaceId), like(transactions.idempotencyKey, `${batchKey}:%`), eq(transactions.status, "posted")));
    if (rows.length === 0) throw new HttpError(404, "Impor tidak ditemukan atau sudah dibatalkan");
    for (const r of rows) await this.txs.void(workspaceId, r.id);
    return { voided: rows.length };
  }
}
