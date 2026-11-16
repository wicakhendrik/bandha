import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { accounts, debts, journals, ledgerEntries, transactions, type Db } from "@bandha/db";
import { dec, roundMoney, type Entry } from "@bandha/ledger";
import type { CreateDebtInput, SettleDebtInput, UpdateDebtInput } from "@bandha/validation";
import { outstandingByDebt } from "./debt-ledger";
import { HttpError } from "./errors";
import { assertUsableAccounts, functionalAsset, liveJournal, postJournal, systemAccountId } from "./ledger-store";
import { TransactionsService } from "./transactions.service";
import { isUniqueViolation, type Tx } from "./types";

const neg = (v: string) => dec(v).neg().toFixed();
const leg = (accountId: string, assetId: string, amount: string): Entry => ({ accountId, assetId, quantity: amount, functionalAmount: amount });

export interface DebtView {
  id: string;
  direction: "payable" | "receivable";
  kind: string;
  counterparty: string;
  note: string | null;
  principal: string;
  paid: string;
  remaining: string;
  status: "open" | "settled";
  /** 0-100, how much of the principal has been settled. */
  progress: number;
  dueDate: string | null;
  createdAt: Date;
}

type DebtRow = typeof debts.$inferSelect;

function view(d: DebtRow, remaining: string): DebtView {
  const principal = dec(d.principal);
  const rem = dec(remaining);
  const paid = principal.minus(rem);
  return {
    id: d.id,
    direction: d.direction,
    kind: d.kind,
    counterparty: d.counterparty,
    note: d.note,
    principal: principal.toFixed(),
    paid: paid.toFixed(),
    remaining: rem.toFixed(),
    status: rem.isZero() ? "settled" : "open",
    progress: principal.isZero() ? 0 : Math.min(100, Math.max(0, paid.div(principal).times(100).toNumber())),
    dueDate: d.dueDate,
    createdAt: d.createdAt,
  };
}

export class DebtsService {
  private readonly txs: TransactionsService;
  constructor(private readonly db: Db) {
    this.txs = new TransactionsService(db);
  }

  /** Open debts first (earliest due date first, undated after), settled ones last. */
  async list(workspaceId: string) {
    const rows = await this.db.select().from(debts).where(and(eq(debts.workspaceId, workspaceId), isNull(debts.voidedAt))).orderBy(desc(debts.createdAt));
    const rem = await outstandingByDebt(this.db, workspaceId, rows.map((r) => r.id));
    const list = rows.map((r) => view(r, rem.get(r.id) ?? "0"));
    const open = list.filter((d) => d.status === "open");
    const sum = (dir: DebtView["direction"]) => open.filter((d) => d.direction === dir).reduce((a, d) => a.plus(dec(d.remaining)), dec("0")).toFixed();
    const rank = (d: DebtView) => (d.status === "settled" ? 2 : d.dueDate ? 0 : 1);
    list.sort((a, b) => rank(a) - rank(b) || (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
    return { debts: list, totals: { payable: sum("payable"), receivable: sum("receivable") } };
  }

  async get(workspaceId: string, id: string) {
    const [d] = await this.db.select().from(debts).where(and(eq(debts.id, id), eq(debts.workspaceId, workspaceId), isNull(debts.voidedAt)));
    if (!d) throw new HttpError(404, "Utang/piutang tidak ditemukan");
    const rem = (await outstandingByDebt(this.db, workspaceId, [id])).get(id) ?? "0";

    const rows = await this.db
      .select()
      .from(transactions)
      .where(and(eq(transactions.debtId, id), eq(transactions.workspaceId, workspaceId), ne(transactions.status, "void")))
      .orderBy(desc(transactions.occurredAt), desc(transactions.createdAt));
    const legs = rows.length === 0 ? [] : await this.db
      .select({
        transactionId: journals.transactionId, fa: ledgerEntries.functionalAmount,
        accountId: accounts.id, name: accounts.name, kind: accounts.kind, brandKey: accounts.brandKey, isSystem: accounts.isSystem,
      })
      .from(ledgerEntries)
      .innerJoin(journals, eq(journals.id, ledgerEntries.journalId))
      .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
      .where(and(inArray(journals.transactionId, rows.map((r) => r.id)), liveJournal));

    const history = rows.map((t) => {
      const mine = legs.filter((l) => l.transactionId === t.id);
      const control = mine.find((l) => l.isSystem && (l.kind === "liability" || l.kind === "receivable"));
      const interest = mine.filter((l) => l.isSystem && (l.kind === "income" || l.kind === "expense")).reduce((a, l) => a.plus(dec(l.fa).abs()), dec("0"));
      const acc = mine.find((l) => !l.isSystem);
      return {
        id: t.id,
        type: t.type,
        occurredAt: t.occurredAt,
        note: t.description,
        amount: control ? dec(control.fa).abs().toFixed() : "0",
        interest: interest.toFixed(),
        account: acc ? { id: acc.accountId, name: acc.name, kind: acc.kind, brandKey: acc.brandKey } : null,
      };
    });
    return { debt: view(d, rem), history };
  }

  private async findByKey(workspaceId: string, key: string) {
    const [row] = await this.db
      .select({ id: transactions.id, debtId: transactions.debtId })
      .from(transactions)
      .where(and(eq(transactions.workspaceId, workspaceId), eq(transactions.idempotencyKey, key)));
    return row;
  }

  async create(workspaceId: string, userId: string, input: CreateDebtInput): Promise<{ id: string; replayed: boolean }> {
    try {
      return await this.createInner(workspaceId, userId, input);
    } catch (err) {
      if (input.idempotencyKey && isUniqueViolation(err)) {
        const existing = await this.findByKey(workspaceId, input.idempotencyKey);
        if (existing?.debtId) return { id: existing.debtId, replayed: true };
      }
      throw err;
    }
  }

  private async createInner(workspaceId: string, userId: string, input: CreateDebtInput) {
    if (input.idempotencyKey) {
      const existing = await this.findByKey(workspaceId, input.idempotencyKey);
      if (existing?.debtId) return { id: existing.debtId, replayed: true };
    }
    const principal = roundMoney(dec(input.principal).toFixed());
    if (dec(principal).isZero()) throw new HttpError(400, "Jumlah terlalu kecil");

    return this.db.transaction(async (tx) => {
      const payable = input.direction === "payable";
      const fn = await functionalAsset(tx, workspaceId);
      const control = await systemAccountId(tx, workspaceId, payable ? "liability" : "receivable");
      let counter: string;
      if (input.accountId) {
        await assertUsableAccounts(tx, workspaceId, [input.accountId]);
        counter = input.accountId;
      } else {
        // An existing contract that never touched a Bandha account: balanced against equity, like an opening balance.
        counter = await systemAccountId(tx, workspaceId, "equity");
      }

      const [d] = await tx
        .insert(debts)
        .values({
          workspaceId, direction: input.direction, kind: input.kind, counterparty: input.counterparty,
          note: input.note ?? null, principal, dueDate: input.dueDate ?? null,
        })
        .returning({ id: debts.id });
      if (!d) throw new Error("Debt insert failed");

      const occurredAt = input.occurredAt ?? new Date();
      const [t] = await tx
        .insert(transactions)
        .values({
          workspaceId, type: payable ? "borrow" : "lend", status: "posted", occurredAt, description: input.note ?? null,
          debtId: d.id, idempotencyKey: input.idempotencyKey ?? null, createdByUserId: userId,
        })
        .returning({ id: transactions.id });
      if (!t) throw new Error("Transaction insert failed");

      // Borrowing: money in (debit), liability up (credit). Lending: receivable up (debit), money out (credit).
      const entries = payable
        ? [leg(counter, fn.id, principal), leg(control, fn.id, neg(principal))]
        : [leg(control, fn.id, principal), leg(counter, fn.id, neg(principal))];
      await postJournal(tx, { workspaceId, transactionId: t.id, postedAt: occurredAt, entries });
      return { id: d.id, replayed: false };
    });
  }

  /** Repay (payable) or collect (receivable). The interest part is booked as expense / income, never into the principal. */
  async settle(workspaceId: string, userId: string, id: string, input: SettleDebtInput): Promise<{ id: string; replayed: boolean }> {
    try {
      return await this.settleInner(workspaceId, userId, id, input);
    } catch (err) {
      if (input.idempotencyKey && isUniqueViolation(err)) {
        const existing = await this.findByKey(workspaceId, input.idempotencyKey);
        if (existing) return { id: existing.id, replayed: true };
      }
      throw err;
    }
  }

  private async settleInner(workspaceId: string, userId: string, id: string, input: SettleDebtInput) {
    if (input.idempotencyKey) {
      const existing = await this.findByKey(workspaceId, input.idempotencyKey);
      if (existing) return { id: existing.id, replayed: true };
    }
    const amount = roundMoney(dec(input.amount).toFixed());
    const interest = input.interest ? roundMoney(dec(input.interest).toFixed()) : "0";
    if (dec(amount).isZero()) throw new HttpError(400, "Jumlah terlalu kecil");

    return this.db.transaction(async (tx: Tx) => {
      const [d] = await tx.select().from(debts).where(and(eq(debts.id, id), eq(debts.workspaceId, workspaceId), isNull(debts.voidedAt))).for("update");
      if (!d) throw new HttpError(404, "Utang/piutang tidak ditemukan");
      const remaining = dec((await outstandingByDebt(tx, workspaceId, [id])).get(id) ?? "0");
      if (dec(amount).gt(remaining)) {
        throw new HttpError(400, remaining.isZero() ? "Sudah lunas" : `Jumlah melebihi sisa (${remaining.toFixed()})`);
      }
      await assertUsableAccounts(tx, workspaceId, [input.accountId]);

      const payable = d.direction === "payable";
      const fn = await functionalAsset(tx, workspaceId);
      const control = await systemAccountId(tx, workspaceId, payable ? "liability" : "receivable");
      const cashTotal = dec(amount).plus(interest).toFixed();
      const hasInterest = !dec(interest).isZero();

      const entries: Entry[] = payable
        ? [leg(control, fn.id, amount), leg(input.accountId, fn.id, neg(cashTotal))]
        : [leg(input.accountId, fn.id, cashTotal), leg(control, fn.id, neg(amount))];
      if (hasInterest) {
        entries.push(payable
          ? leg(await systemAccountId(tx, workspaceId, "expense"), fn.id, interest)
          : leg(await systemAccountId(tx, workspaceId, "income"), fn.id, neg(interest)));
      }

      const occurredAt = input.occurredAt ?? new Date();
      const [t] = await tx
        .insert(transactions)
        .values({
          workspaceId, type: payable ? "repay" : "collect", status: "posted", occurredAt, description: input.note ?? null,
          category: hasInterest ? (payable ? "Bunga utang" : "Bunga piutang") : null,
          debtId: d.id, idempotencyKey: input.idempotencyKey ?? null, createdByUserId: userId,
        })
        .returning({ id: transactions.id });
      if (!t) throw new Error("Transaction insert failed");
      await postJournal(tx, { workspaceId, transactionId: t.id, postedAt: occurredAt, entries });
      return { id: t.id, replayed: false };
    });
  }

  async update(workspaceId: string, id: string, patch: UpdateDebtInput) {
    const [row] = await this.db
      .update(debts)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(debts.id, id), eq(debts.workspaceId, workspaceId), isNull(debts.voidedAt)))
      .returning({ id: debts.id });
    if (!row) throw new HttpError(404, "Utang/piutang tidak ditemukan");
  }

  /** Voids the whole contract by voiding its opening transaction. Refused while payments exist. */
  async void(workspaceId: string, id: string) {
    const [opening] = await this.db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.debtId, id), eq(transactions.workspaceId, workspaceId), eq(transactions.status, "posted"), inArray(transactions.type, ["borrow", "lend"])));
    if (!opening) throw new HttpError(404, "Utang/piutang tidak ditemukan");
    await this.txs.void(workspaceId, opening.id);
  }
}
