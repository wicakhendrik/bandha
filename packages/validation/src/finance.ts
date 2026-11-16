import { z } from "zod";

/** Decimals travel as strings end to end; JavaScript floats never touch money. */
const decimalString = z.string().regex(/^\d+(\.\d{1,18})?$/, "Angka tidak valid");
export const positiveDecimal = decimalString.refine((v) => !/^0+(\.0+)?$/.test(v), "Harus lebih dari 0");
export const nonNegativeDecimal = decimalString;

export const USER_ACCOUNT_KINDS = ["cash", "bank", "ewallet", "exchange", "wallet", "brokerage", "gold", "property", "other"] as const;
export const userAccountKind = z.enum(USER_ACCOUNT_KINDS);

export const openingBalanceSchema = z.object({
  assetId: z.uuid(),
  quantity: nonNegativeDecimal,
  /** Required unless the asset is the workspace functional currency. */
  functionalAmount: nonNegativeDecimal.optional(),
});

export const brandKeySchema = z.string().regex(/^[a-z0-9-]{1,40}$/, "Kunci brand tidak valid");

export const createAccountSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: userAccountKind,
  brandKey: brandKeySchema.optional(),
  institutionId: z.uuid().optional(),
  includeInNetWorth: z.boolean().default(true),
  openingBalance: openingBalanceSchema.optional(),
});
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export const updateAccountSchema = z
  .object({ name: z.string().trim().min(1).max(80), kind: userAccountKind, includeInNetWorth: z.boolean(), brandKey: brandKeySchema.nullable() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Tidak ada perubahan");
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

const txMeta = {
  occurredAt: z.coerce.date().optional(),
  description: z.string().trim().max(200).optional(),
  category: z.string().trim().max(60).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  /** Retry safety: resending the same key never posts twice. */
  idempotencyKey: z.string().min(8).max(100).optional(),
};

export const createTransactionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("income"),
    accountId: z.uuid(),
    assetId: z.uuid(),
    quantity: positiveDecimal,
    functionalAmount: positiveDecimal.optional(),
    ...txMeta,
  }),
  z.object({
    type: z.literal("expense"),
    accountId: z.uuid(),
    assetId: z.uuid(),
    quantity: positiveDecimal,
    functionalAmount: positiveDecimal.optional(),
    ...txMeta,
  }),
  z.object({
    type: z.literal("transfer"),
    fromAccountId: z.uuid(),
    toAccountId: z.uuid(),
    assetId: z.uuid(),
    quantity: positiveDecimal,
    functionalAmount: positiveDecimal.optional(),
    ...txMeta,
  }),
  /** Buy an asset with the functional currency (IDR). `totalCost` excludes the fee, which is a separate expense. */
  z.object({
    type: z.literal("buy"),
    accountId: z.uuid(),
    fundingAccountId: z.uuid().optional(),
    assetId: z.uuid(),
    quantity: positiveDecimal,
    totalCost: positiveDecimal,
    fee: nonNegativeDecimal.optional(),
    ...txMeta,
  }),
  /** Sell an asset for the functional currency. Realised profit/loss is computed from the average cost. */
  z.object({
    type: z.literal("sell"),
    accountId: z.uuid(),
    receivingAccountId: z.uuid().optional(),
    assetId: z.uuid(),
    quantity: positiveDecimal,
    proceeds: positiveDecimal,
    fee: nonNegativeDecimal.optional(),
    ...txMeta,
  }),
]);
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

/**
 * Full edit of a posted transaction: same fields as creating one (the type cannot change). Opening balances carry only
 * the amount, because their account and asset are fixed.
 */
export const replaceTransactionSchema = z.discriminatedUnion("type", [
  ...createTransactionSchema.options,
  z.object({ type: z.literal("opening"), quantity: positiveDecimal, functionalAmount: positiveDecimal.optional(), ...txMeta }),
]);
export type ReplaceTransactionInput = z.infer<typeof replaceTransactionSchema>;

/** Posted transactions only allow safe metadata edits; amounts and accounts are immutable. */
export const updateTransactionSchema = z
  .object({
    description: z.string().trim().max(200).nullable(),
    category: z.string().trim().max(60).nullable(),
    tags: z.array(z.string().trim().min(1).max(30)).max(10),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Tidak ada perubahan");
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;

/** Adds a coin from CoinGecko to the asset catalog. The id is CoinGecko's slug, e.g. "near". */
export const addCryptoSchema = z.object({
  coingeckoId: z.string().regex(/^[a-z0-9-]{1,100}$/, "ID CoinGecko tidak valid"),
});
export type AddCryptoInput = z.infer<typeof addCryptoSchema>;

/* ───────── Debts & receivables ───────── */

export const DEBT_KINDS = ["personal", "credit_card", "mortgage", "installment", "other"] as const;
export const debtKind = z.enum(DEBT_KINDS);
export const debtDirection = z.enum(["payable", "receivable"]);
const dateKey = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Tanggal harus berformat TTTT-BB-HH")
  .refine((v) => {
    const [y, m, d] = v.split("-").map(Number) as [number, number, number];
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }, "Tanggal tidak ada di kalender");

/**
 * Opens a debt (payable = I borrowed, receivable = I lent). With `accountId` the money moves in/out of that account;
 * without it the contract is recorded as already existing (e.g. a mortgage taken before using Bandha).
 */
export const createDebtSchema = z.object({
  direction: debtDirection,
  kind: debtKind.default("personal"),
  counterparty: z.string().trim().min(1, "Isi nama pihak terkait").max(80),
  principal: positiveDecimal,
  accountId: z.uuid().optional(),
  dueDate: dateKey.optional(),
  note: z.string().trim().max(200).optional(),
  occurredAt: z.coerce.date().optional(),
  idempotencyKey: z.string().min(8).max(100).optional(),
});
export type CreateDebtInput = z.infer<typeof createDebtSchema>;

/** A repayment (payable) or collection (receivable). `interest` is booked separately as expense / income. */
export const settleDebtSchema = z.object({
  accountId: z.uuid(),
  amount: positiveDecimal,
  interest: nonNegativeDecimal.optional(),
  note: z.string().trim().max(200).optional(),
  occurredAt: z.coerce.date().optional(),
  idempotencyKey: z.string().min(8).max(100).optional(),
});
export type SettleDebtInput = z.infer<typeof settleDebtSchema>;

export const updateDebtSchema = z
  .object({ counterparty: z.string().trim().min(1).max(80), kind: debtKind, note: z.string().trim().max(200).nullable(), dueDate: dateKey.nullable() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Tidak ada perubahan");
export type UpdateDebtInput = z.infer<typeof updateDebtSchema>;

/* ───────── CSV import ───────── */

const columnIndex = z.number().int().min(0).max(200).nullable();
export const importMappingSchema = z.object({
  date: columnIndex, description: columnIndex, amount: columnIndex, debit: columnIndex, credit: columnIndex, category: columnIndex,
});

/** Step 1: parse and check a statement without writing anything. The text is never stored. */
export const importPreviewSchema = z.object({
  accountId: z.uuid(),
  csv: z.string().min(1, "File kosong").max(1_000_000, "File terlalu besar (maksimal 1 MB)"),
  mapping: importMappingSchema.optional(),
  dateOrder: z.enum(["dmy", "mdy"]).default("dmy"),
});
export type ImportPreviewInput = z.infer<typeof importPreviewSchema>;

export const importRowSchema = z.object({
  day: dateKey,
  time: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  description: z.string().trim().max(200).default(""),
  category: z.string().trim().max(60).nullish(),
  type: z.enum(["income", "expense"]),
  amount: positiveDecimal,
});

/** Step 2: post the chosen rows, all or nothing. `batchKey` makes a retry harmless and lets the whole import be undone. */
export const importCommitSchema = z.object({
  accountId: z.uuid(),
  batchKey: z.string().min(8).max(60).regex(/^[A-Za-z0-9-]+$/, "Kunci impor tidak valid"),
  rows: z.array(importRowSchema).min(1, "Tidak ada baris untuk diimpor").max(2000, "Maksimal 2000 baris per impor"),
});
export type ImportCommitInput = z.infer<typeof importCommitSchema>;
