import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { accounts, debts, journals, ledgerEntries, transactions, type Db } from "@bandha/db";
import {
  applySell, applyTransfer, buildBuy, buildOpeningBalance, buildExpense, buildIncome, buildSell, buildTransfer, dec, reverseEntries, roundMoney, type Entry,
} from "@bandha/ledger";
import type { CreateTransactionInput, ReplaceTransactionInput, UpdateTransactionInput } from "@bandha/validation";
import { functionalAmountFor } from "./accounts.service";
import { guardDebtVoid } from "./debt-ledger";
import { HttpError } from "./errors";
import { assertUsableAccounts, functionalAsset, LIVE_J, liveJournal, liveJournalOf, postJournal, systemAccountId } from "./ledger-store";
import { lockAccounts, positionOf } from "./positions";
import { isUniqueViolation, type Tx } from "./types";

const EDITABLE_TYPES = new Set(["income", "expense", "transfer", "buy", "sell", "opening"]);
/** Debt transactions are changed from the debt itself (their remaining balance depends on it). */
const isEditable = (t: { type: string; debtId: string | null; status: string }) => t.status === "posted" && !t.debtId && EDITABLE_TYPES.has(t.type);

const LATER_USE_MESSAGE =
  "Aset ini sudah dipakai transaksi lain setelahnya (jual, transfer, atau beli lagi). Ubah atau batalkan transaksi yang lebih baru dulu, supaya modal rata-rata tidak berubah diam-diam";

export class TransactionsService {
  constructor(private readonly db: Db) {}

  private assertUsableAccounts(tx: Tx, workspaceId: string, ids: string[]) {
    return assertUsableAccounts(tx, workspaceId, ids);
  }

  async create(workspaceId: string, userId: string, input: CreateTransactionInput) {
    try {
      return await this.createInner(workspaceId, userId, input);
    } catch (err) {
      // Two concurrent requests with the same idempotency key: the loser returns the winner's result.
      if (input.idempotencyKey && isUniqueViolation(err)) {
        const existing = await this.findByKey(workspaceId, input.idempotencyKey);
        if (existing) return { id: existing.id, replayed: true };
      }
      throw err;
    }
  }

  private async findByKey(workspaceId: string, key: string) {
    const [row] = await this.db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.workspaceId, workspaceId), eq(transactions.idempotencyKey, key)));
    return row;
  }

  /** Trading functional currency against itself is meaningless; it is a plain income/expense/transfer instead. */
  private async assertTradable(tx: Tx, workspaceId: string, assetId: string) {
    const fn = await functionalAsset(tx, workspaceId);
    if (assetId === fn.id) throw new HttpError(400, `Aset ${fn.symbol} tidak bisa dibeli atau dijual, gunakan pemasukan, pengeluaran, atau transfer`);
    return fn;
  }

  private async buildEntries(tx: Tx, workspaceId: string, input: CreateTransactionInput): Promise<Entry[]> {
    const fee = async (amount: string | undefined) =>
      amount && !dec(amount).isZero() ? { amount: dec(amount).toFixed(), expenseAccountId: await systemAccountId(tx, workspaceId, "expense") } : undefined;

    switch (input.type) {
      case "transfer": {
        await this.assertUsableAccounts(tx, workspaceId, [input.fromAccountId, input.toAccountId]);
        const fn = await functionalAsset(tx, workspaceId);
        let functionalAmount: string;
        if (input.assetId === fn.id) {
          functionalAmount = dec(input.quantity).toFixed();
        } else {
          // Moving a held asset carries its cost basis proportionally and realises no profit or loss.
          await lockAccounts(tx, [input.fromAccountId, input.toAccountId]);
          const from = await positionOf(tx, workspaceId, input.fromAccountId, input.assetId);
          if (dec(input.quantity).gt(dec(from.quantity))) throw new HttpError(400, `Jumlah melebihi yang dimiliki (${from.quantity})`);
          const moved = applyTransfer(from, { quantity: "0", costBasis: "0" }, input.quantity);
          functionalAmount = roundMoney(dec(from.costBasis as string).minus(dec(moved.from.costBasis as string)).toFixed());
        }
        try {
          return buildTransfer({ fromAccountId: input.fromAccountId, toAccountId: input.toAccountId, assetId: input.assetId, quantity: input.quantity, functionalAmount });
        } catch (e) {
          throw new HttpError(400, e instanceof Error ? e.message : "Transfer tidak valid");
        }
      }

      case "buy": {
        const funding = input.fundingAccountId ?? input.accountId;
        await this.assertUsableAccounts(tx, workspaceId, [input.accountId, funding]);
        const fn = await this.assertTradable(tx, workspaceId, input.assetId);
        return buildBuy({
          assetAccountId: input.accountId, assetId: input.assetId, quantity: input.quantity, cost: input.totalCost,
          cashAccountId: funding, cashAssetId: fn.id, fee: await fee(input.fee),
        });
      }

      case "sell": {
        const receiving = input.receivingAccountId ?? input.accountId;
        await this.assertUsableAccounts(tx, workspaceId, [input.accountId, receiving]);
        const fn = await this.assertTradable(tx, workspaceId, input.assetId);
        await lockAccounts(tx, [input.accountId, receiving]);

        const pos = await positionOf(tx, workspaceId, input.accountId, input.assetId);
        if (dec(input.quantity).gt(dec(pos.quantity))) throw new HttpError(400, `Jumlah melebihi yang dimiliki (${pos.quantity})`);

        // Weighted-average cost: realised P/L = proceeds - average cost of the quantity sold.
        const sold = applySell(pos, input.quantity, input.proceeds);
        const soldCost = roundMoney(dec(pos.costBasis as string).minus(dec(sold.position.costBasis as string)).toFixed());
        return buildSell({
          assetAccountId: input.accountId, assetId: input.assetId, quantity: input.quantity, soldCost, proceeds: input.proceeds,
          cashAccountId: receiving, cashAssetId: fn.id, pnlAccountId: await systemAccountId(tx, workspaceId, "pnl"), fee: await fee(input.fee),
        });
      }

      default: {
        await this.assertUsableAccounts(tx, workspaceId, [input.accountId]);
        const functionalAmount = await functionalAmountFor(tx, workspaceId, input.assetId, input.quantity, input.functionalAmount);
        const cash = { accountId: input.accountId, assetId: input.assetId, quantity: input.quantity, functionalAmount };
        return input.type === "income"
          ? buildIncome({ cash, incomeAccountId: await systemAccountId(tx, workspaceId, "income"), incomeAssetId: input.assetId })
          : buildExpense({ cash, expenseAccountId: await systemAccountId(tx, workspaceId, "expense"), expenseAssetId: input.assetId });
      }
    }
  }

  private async createInner(workspaceId: string, userId: string, input: CreateTransactionInput) {
    if (input.idempotencyKey) {
      const existing = await this.findByKey(workspaceId, input.idempotencyKey);
      if (existing) return { id: existing.id, replayed: true };
    }

    return this.db.transaction(async (tx) => {
      const occurredAt = input.occurredAt ?? new Date();
      const entries = await this.buildEntries(tx, workspaceId, input);

      const [t] = await tx
        .insert(transactions)
        .values({
          workspaceId,
          type: input.type,
          status: "posted",
          occurredAt,
          description: input.description ?? null,
          category: "category" in input ? (input.category ?? null) : null,
          tags: input.tags,
          idempotencyKey: input.idempotencyKey ?? null,
          createdByUserId: userId,
        })
        .returning({ id: transactions.id });
      if (!t) throw new Error("Transaction insert failed");
      await postJournal(tx, { workspaceId, transactionId: t.id, postedAt: occurredAt, entries });
      return { id: t.id, replayed: false };
    });
  }

  /** Lists non-void transactions with the user-visible legs (system counter-accounts are hidden). */
  async list(workspaceId: string, limit = 50, offset = 0) {
    const txs = await this.db
      .select()
      .from(transactions)
      .where(and(eq(transactions.workspaceId, workspaceId), ne(transactions.status, "void")))
      .orderBy(desc(transactions.occurredAt), desc(transactions.createdAt))
      .limit(Math.min(limit, 100))
      .offset(offset);
    if (txs.length === 0) return [];

    const legs = await this.db
      .select({
        transactionId: journals.transactionId,
        accountId: ledgerEntries.accountId,
        assetId: ledgerEntries.assetId,
        quantity: ledgerEntries.quantity,
        functionalAmount: ledgerEntries.functionalAmount,
      })
      .from(ledgerEntries)
      .innerJoin(journals, eq(journals.id, ledgerEntries.journalId))
      .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
      .where(and(inArray(journals.transactionId, txs.map((t) => t.id)), liveJournal, eq(accounts.isSystem, false)));

    const debtIds = [...new Set(txs.flatMap((t) => (t.debtId ? [t.debtId] : [])))];
    const debtInfo = new Map(
      debtIds.length === 0
        ? []
        : (await this.db.select({ id: debts.id, counterparty: debts.counterparty, direction: debts.direction }).from(debts).where(inArray(debts.id, debtIds))).map((d) => [d.id, d] as const),
    );

    return txs.map((t) => ({
      id: t.id,
      type: t.type,
      status: t.status,
      occurredAt: t.occurredAt,
      description: t.description,
      category: t.category,
      tags: t.tags,
      debt: t.debtId ? (debtInfo.get(t.debtId) ?? null) : null,
      editable: isEditable(t),
      legs: legs.filter((l) => l.transactionId === t.id).map(({ transactionId: _t, ...rest }) => rest),
    }));
  }

  /** Posted transactions only allow safe metadata edits; amounts and accounts stay immutable. */
  async updateMetadata(workspaceId: string, id: string, patch: UpdateTransactionInput) {
    const [row] = await this.db
      .update(transactions)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(transactions.id, id), eq(transactions.workspaceId, workspaceId), eq(transactions.status, "posted")))
      .returning({ id: transactions.id });
    if (!row) throw new HttpError(404, "Transaksi tidak ditemukan");
  }

  /**
   * User-facing delete = void. Never a hard delete: a reversal journal is posted,
   * the transaction is marked void, and the audit trail stays.
   *
   * Voiding must not leave a held asset negative (e.g. voiding a buy whose coins were already sold):
   * that would make the cost basis meaningless, so it is refused.
   */
  async void(workspaceId: string, id: string) {
    await this.db.transaction(async (tx) => {
      const [t] = await tx
        .select()
        .from(transactions)
        .where(and(eq(transactions.id, id), eq(transactions.workspaceId, workspaceId)))
        .for("update");
      if (!t) throw new HttpError(404, "Transaksi tidak ditemukan");
      if (t.status !== "posted") throw new HttpError(409, "Transaksi sudah dibatalkan");

      const original = await liveJournalOf(tx, id);

      const rows = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.journalId, original.id));
      const reversal = reverseEntries(
        rows.map<Entry>((r) => ({ accountId: r.accountId, assetId: r.assetId, quantity: r.quantity, functionalAmount: r.functionalAmount })),
      );

      if (t.debtId) await guardDebtVoid(tx, workspaceId, { debtId: t.debtId, type: t.type }, reversal);

      const fn = await functionalAsset(tx, workspaceId);
      const held = reversal.filter((e) => e.assetId !== fn.id);
      if (held.length > 0) {
        await lockAccounts(tx, held.map((e) => e.accountId));
        for (const e of held) {
          const sys = await tx.select({ s: accounts.isSystem }).from(accounts).where(eq(accounts.id, e.accountId));
          if (sys[0]?.s) continue;
          const pos = await positionOf(tx, workspaceId, e.accountId, e.assetId);
          if (dec(pos.quantity).plus(dec(e.quantity)).isNegative()) {
            throw new HttpError(409, "Transaksi tidak bisa dibatalkan karena aset hasilnya sudah dijual atau dipindahkan");
          }
        }
      }

      const now = new Date();
      await postJournal(tx, { workspaceId, transactionId: id, postedAt: now, entries: reversal, reversesJournalId: original.id });
      await tx.update(transactions).set({ status: "void", voidedAt: now, updatedAt: now }).where(eq(transactions.id, id));
    });
  }

  /** Loads a posted, editable transaction (locked when `lock`). */
  private async editableRow(tx: Tx, workspaceId: string, id: string, lock: boolean) {
    const q = tx.select().from(transactions).where(and(eq(transactions.id, id), eq(transactions.workspaceId, workspaceId)));
    const [t] = lock ? await q.for("update") : await q;
    if (!t) throw new HttpError(404, "Transaksi tidak ditemukan");
    if (t.status !== "posted") throw new HttpError(409, "Transaksi sudah dibatalkan");
    if (t.debtId) throw new HttpError(409, "Transaksi utang/piutang diubah dari halaman Utang & piutang");
    if (!EDITABLE_TYPES.has(t.type)) throw new HttpError(409, "Jenis transaksi ini tidak bisa diedit");
    return t;
  }

  /** The legs of a transaction's live journal, with what kind of account each one is on. */
  private async liveLegs(tx: Tx, journalId: string) {
    return tx
      .select({
        accountId: ledgerEntries.accountId, assetId: ledgerEntries.assetId, quantity: ledgerEntries.quantity,
        functionalAmount: ledgerEntries.functionalAmount, isSystem: accounts.isSystem, kind: accounts.kind,
      })
      .from(ledgerEntries)
      .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
      .where(eq(ledgerEntries.journalId, journalId));
  }

  /**
   * The transaction in the shape of the create/edit form, rebuilt from its live journal (so it is always what the
   * books say, even for transactions created before editing existed).
   */
  async getEditable(workspaceId: string, id: string) {
    return this.db.transaction(async (tx) => {
      const t = await this.editableRow(tx, workspaceId, id, false);
      const live = await liveJournalOf(tx, id);
      const legs = await this.liveLegs(tx, live.id);
      const fn = await functionalAsset(tx, workspaceId);
      const user = legs.filter((l) => !l.isSystem);
      const abs = (v: string) => dec(v).abs().toFixed();
      const neg = (v: string) => dec(v).isNegative();
      // Empty fields are left out so the result can be sent straight back to PUT (the schema has no nulls).
      const base = {
        id: t.id, type: t.type, occurredAt: t.occurredAt.toISOString(),
        ...(t.description ? { description: t.description } : {}), ...(t.category ? { category: t.category } : {}),
      };
      const fx = (l: { assetId: string; functionalAmount: string }) => (l.assetId === fn.id ? {} : { functionalAmount: abs(l.functionalAmount) });
      const bad = () => new HttpError(409, "Transaksi ini tidak bisa dimuat untuk diedit");

      switch (t.type) {
        case "income":
        case "expense":
        case "opening": {
          const l = user[0];
          if (!l) throw bad();
          return { ...base, accountId: l.accountId, assetId: l.assetId, quantity: abs(l.quantity), ...fx(l) };
        }
        case "transfer": {
          const out = user.find((l) => neg(l.quantity));
          const inn = user.find((l) => !neg(l.quantity));
          if (!out || !inn) throw bad();
          return { ...base, fromAccountId: out.accountId, toAccountId: inn.accountId, assetId: out.assetId, quantity: abs(out.quantity), ...fx(out) };
        }
        case "buy":
        case "sell": {
          const held = user.find((l) => l.assetId !== fn.id);
          if (!held) throw bad();
          const fee = legs.filter((l) => l.isSystem && l.kind === "expense").reduce((a, l) => a.plus(dec(l.functionalAmount)), dec("0"));
          const cash = user.filter((l) => l.assetId === fn.id);
          const common = { ...base, accountId: held.accountId, assetId: held.assetId, quantity: abs(held.quantity), ...(fee.isZero() ? {} : { fee: fee.toFixed() }) };
          if (t.type === "buy") {
            const out = cash.find((l) => neg(l.quantity));
            if (!out) throw bad();
            return { ...common, fundingAccountId: out.accountId, totalCost: abs(held.functionalAmount) };
          }
          const proceeds = cash.filter((l) => !neg(l.quantity));
          if (proceeds.length === 0) throw bad();
          return { ...common, receivingAccountId: proceeds[0]!.accountId, proceeds: proceeds.reduce((a, l) => a.plus(dec(l.quantity)), dec("0")).toFixed() };
        }
        default:
          throw bad();
      }
    });
  }

  /**
   * Edits a posted transaction the accounting way: the live journal is reversed and a replacement journal is posted,
   * all in one database transaction, so history stays complete and the ledger never stops balancing. The type, and for
   * balances the account and asset, cannot change (void and re-create instead).
   *
   * Cost basis is order dependent (weighted average), so an asset leg is only editable while nothing else has used the
   * same account and asset since: otherwise the profit already booked on a later sale would silently go stale.
   */
  async replace(workspaceId: string, id: string, input: ReplaceTransactionInput) {
    await this.db.transaction(async (tx) => {
      const t = await this.editableRow(tx, workspaceId, id, true);
      if (t.type !== input.type) throw new HttpError(400, "Jenis transaksi tidak bisa diubah. Batalkan lalu catat ulang");

      const live = await liveJournalOf(tx, id);
      const oldLegs = await this.liveLegs(tx, live.id);
      const fn = await functionalAsset(tx, workspaceId);

      const heldPairs = new Map<string, { accountId: string; assetId: string }>();
      for (const l of oldLegs) if (!l.isSystem && l.assetId !== fn.id) heldPairs.set(`${l.accountId}:${l.assetId}`, { accountId: l.accountId, assetId: l.assetId });
      const pairs = [...heldPairs.values()];
      if (pairs.length > 0) {
        await lockAccounts(tx, pairs.map((p) => p.accountId));
        const list = sql.join(pairs.map((p) => sql`(${p.accountId}::uuid, ${p.assetId}::uuid)`), sql`, `);
        const later = await tx.execute(sql`
          select 1 from ledger_entries e
          join journals j on j.id = e.journal_id
          join transactions t on t.id = j.transaction_id
          where e.workspace_id = ${workspaceId} and (e.account_id, e.asset_id) in (${list})
            and j.transaction_id <> ${id}::uuid and t.status = 'posted' and ${LIVE_J} and j.created_at > ${live.createdAt}
          limit 1`);
        if (later.rows.length > 0) throw new HttpError(409, LATER_USE_MESSAGE);
      }

      const now = new Date();
      const reversal = reverseEntries(oldLegs.map<Entry>((l) => ({ accountId: l.accountId, assetId: l.assetId, quantity: l.quantity, functionalAmount: l.functionalAmount })));
      await postJournal(tx, { workspaceId, transactionId: id, postedAt: now, entries: reversal, reversesJournalId: live.id });

      let entries: Entry[];
      if (input.type === "opening") {
        const leg = oldLegs.find((l) => !l.isSystem);
        if (!leg) throw new Error("Opening leg missing");
        const functionalAmount = await functionalAmountFor(tx, workspaceId, leg.assetId, input.quantity, input.functionalAmount);
        entries = buildOpeningBalance({
          account: { accountId: leg.accountId, assetId: leg.assetId, quantity: input.quantity, functionalAmount },
          equityAccountId: await systemAccountId(tx, workspaceId, "equity"),
          equityAssetId: leg.assetId,
        });
      } else {
        entries = await this.buildEntries(tx, workspaceId, input);
      }
      const occurredAt = input.occurredAt ?? t.occurredAt;
      await postJournal(tx, { workspaceId, transactionId: id, postedAt: occurredAt, entries });

      // Whatever was touched must still be a real holding: never a negative amount of an asset.
      const touched = new Map<string, { accountId: string; assetId: string }>();
      for (const e of [...reversal, ...entries]) if (e.assetId !== fn.id) touched.set(`${e.accountId}:${e.assetId}`, { accountId: e.accountId, assetId: e.assetId });
      if (touched.size > 0) {
        const sys = new Set(
          (await tx.select({ id: accounts.id }).from(accounts).where(and(inArray(accounts.id, [...touched.values()].map((p) => p.accountId)), eq(accounts.isSystem, true)))).map((r) => r.id),
        );
        for (const p of touched.values()) {
          if (sys.has(p.accountId)) continue;
          const pos = await positionOf(tx, workspaceId, p.accountId, p.assetId);
          if (dec(pos.quantity).isNegative()) throw new HttpError(409, "Perubahan ini membuat jumlah aset menjadi negatif");
        }
      }

      await tx
        .update(transactions)
        .set({ occurredAt, description: input.description ?? null, category: "category" in input ? (input.category ?? null) : null, updatedAt: now })
        .where(eq(transactions.id, id));
    });
  }
}
