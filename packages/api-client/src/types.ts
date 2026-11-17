// Shapes returned by the Bandha API. Decimal values are strings by contract.
export interface Asset {
  id: string; symbol: string; name: string; kind: string; decimals: number;
  /** Rupiah per unit (grams for gold), when a price is known. */
  price?: string | null;
  /** CoinGecko slug, for crypto. */
  providerRef?: string | null;
}

/** A coin from the CoinGecko search: in the catalog already (assetId set) or addable. */
export interface CoinChoice {
  assetId: string | null; coingeckoId: string; symbol: string; name: string; rank: number | null; price: string | null; thumb?: string;
}

export interface CashflowDetail {
  month: string;
  kind: "income" | "expense";
  total: string;
  categories: Array<{ category: string | null; total: string; percent: string }>;
  transactions: Array<{
    id: string; type: string; occurredAt: string; description: string | null; category: string | null; symbol: string; amount: string;
    account: { id: string; name: string; kind: string; brandKey: string | null } | null;
  }>;
}
export interface Balance { assetId: string; symbol: string; quantity: string }
export interface Account { id: string; name: string; kind: string; brandKey: string | null; includeInNetWorth: boolean; balances: Balance[] }
export interface Leg { accountId: string; assetId: string; quantity: string; functionalAmount: string }
export interface Tx {
  id: string;
  type: "income" | "expense" | "transfer" | "opening" | "buy" | "sell" | "adjustment" | "borrow" | "lend" | "repay" | "collect";
  status: string;
  occurredAt: string;
  description: string | null;
  category: string | null;
  tags: string[];
  legs: Leg[];
  /** Set on transactions that open or settle a debt. */
  debt?: { id: string; counterparty: string; direction: DebtDirection } | null;
  /** False for debt transactions (changed from the debt itself) and anything else that cannot be edited. */
  editable?: boolean;
}

/** A posted transaction in the shape of the form, ready to edit and send back with PUT. */
export interface EditableTx {
  id: string;
  type: "income" | "expense" | "transfer" | "buy" | "sell" | "opening";
  occurredAt: string;
  description?: string;
  category?: string;
  accountId?: string;
  fromAccountId?: string;
  toAccountId?: string;
  fundingAccountId?: string;
  receivingAccountId?: string;
  assetId: string;
  quantity: string;
  functionalAmount?: string;
  totalCost?: string;
  proceeds?: string;
  /** Rupiah by default; in the paying / received asset when `payAssetId` / `receiveAssetId` is set. */
  fee?: string;
  /** Buy paid with another asset instead of rupiah (`totalCost` is then that payment's rupiah value). */
  payAssetId?: string;
  payQuantity?: string;
  /** Sell for another asset instead of rupiah (`proceeds` is then that amount's rupiah value). */
  receiveAssetId?: string;
  receiveQuantity?: string;
}
export interface Holding {
  assetId: string; symbol: string; name: string; kind: string; quantity: string;
  price: string | null; value: string | null; stale: boolean; accountCount: number;
}
export interface Dashboard {
  functionalCurrency: string; netWorth: string; complete: boolean; unpriced: string[];
  /** Outstanding amounts; already included in `netWorth` (receivables added, payables subtracted). */
  debts: { payable: string; receivable: string };
  allocation: Array<{ key: string; value: string; percent: string }>;
  holdings: Holding[];
}
export interface CashflowMonth { month: string; income: string; expense: string; net: string }
export interface HistoryPoint { day: string; netWorth: string; complete: boolean }
export interface PublicUser { id: string; name: string; email: string }
export interface Me { user: PublicUser; workspaceId: string }

export interface CreateAccountBody {
  name: string;
  kind: string;
  brandKey?: string;
  includeInNetWorth?: boolean;
  openingBalance?: { assetId: string; quantity: string; functionalAmount?: string };
}

export type CreateTransactionBody =
  | { type: "income" | "expense"; accountId: string; assetId: string; quantity: string; functionalAmount?: string; category?: string; description?: string; occurredAt?: string; idempotencyKey?: string }
  | { type: "buy"; accountId: string; fundingAccountId?: string; assetId: string; quantity: string; totalCost: string; fee?: string; description?: string; occurredAt?: string; idempotencyKey?: string }
  | { type: "sell"; accountId: string; receivingAccountId?: string; assetId: string; quantity: string; proceeds: string; fee?: string; description?: string; occurredAt?: string; idempotencyKey?: string }
  | { type: "transfer"; fromAccountId: string; toAccountId: string; assetId: string; quantity: string; functionalAmount?: string; description?: string; occurredAt?: string; idempotencyKey?: string };

export interface PortfolioPosition {
  assetId: string; symbol: string; name: string; kind: string;
  quantity: string;
  /** Weighted-average cost basis of what is still held, in IDR. */
  costBasis: string;
  avgCost: string;
  price: string | null;
  marketValue: string | null;
  unrealizedPnl: string | null;
  unrealizedPct: string | null;
  stale: boolean;
  /** The functional currency (IDR), shown as cash: no profit/loss. */
  cash: boolean;
  accounts: Array<{ accountId: string; name: string; quantity: string; costBasis: string }>;
}
export interface Portfolio {
  functionalCurrency: string;
  complete: boolean;
  unpriced: string[];
  totals: { marketValue: string; investedValue: string; cashValue: string; costBasis: string; unrealizedPnl: string; unrealizedPct: string | null; realizedPnl: string };
  positions: PortfolioPosition[];
  realized: Array<{ symbol: string; realized: string }>;
}

/** One asset with the accounts that hold it (the "Aset" screen). */
export interface AssetHolding {
  assetId: string; symbol: string; name: string; kind: string;
  quantity: string;
  price: string | null;
  value: string | null;
  stale: boolean;
  accounts: Array<{ accountId: string; name: string; kind: string; brandKey: string | null; quantity: string; value: string | null }>;
}
export interface Holdings {
  functionalCurrency: string;
  totalValue: string;
  complete: boolean;
  unpriced: string[];
  assets: AssetHolding[];
}

/** One line of an account statement: a single asset movement with the running balance after it. */
export interface LedgerRow {
  transactionId: string;
  type: Tx["type"];
  occurredAt: string;
  description: string | null;
  category: string | null;
  assetId: string;
  symbol: string;
  quantity: string;
  functionalAmount: string;
  balance: string;
}
export interface AccountLedger {
  account: { id: string; name: string; kind: string; brandKey: string | null; includeInNetWorth: boolean };
  /** Set when the statement is limited to one asset. */
  asset: Asset | null;
  balances: Array<{ assetId: string; symbol: string; name: string; kind: string; quantity: string; price: string | null; value: string | null }>;
  totalValue: string;
  complete: boolean;
  rows: LedgerRow[];
  hasMore: boolean;
}

export type DebtDirection = "payable" | "receivable";
export type DebtKind = "personal" | "credit_card" | "mortgage" | "installment" | "other";
export interface Debt {
  id: string;
  direction: DebtDirection;
  kind: DebtKind;
  counterparty: string;
  note: string | null;
  principal: string;
  paid: string;
  remaining: string;
  status: "open" | "settled";
  /** 0-100 */
  progress: number;
  dueDate: string | null;
  createdAt: string;
}
export interface DebtList { debts: Debt[]; totals: { payable: string; receivable: string } }
export interface DebtHistoryRow {
  id: string;
  type: "borrow" | "lend" | "repay" | "collect";
  occurredAt: string;
  note: string | null;
  amount: string;
  interest: string;
  account: { id: string; name: string; kind: string; brandKey: string | null } | null;
}
export interface DebtDetail { debt: Debt; history: DebtHistoryRow[] }
export interface CreateDebtBody {
  direction: DebtDirection;
  kind?: DebtKind;
  counterparty: string;
  principal: string;
  accountId?: string;
  dueDate?: string;
  note?: string;
  occurredAt?: string;
  idempotencyKey?: string;
}
export interface SettleDebtBody { accountId: string; amount: string; interest?: string; note?: string; occurredAt?: string; idempotencyKey?: string }

/* ───── CSV import ───── */
export interface ImportMapping {
  date: number | null; description: number | null; amount: number | null; debit: number | null; credit: number | null; category: number | null;
}
export interface ImportRow {
  line: number;
  /** "YYYY-MM-DD" (Asia/Jakarta) and an optional "HH:mm". */
  day: string;
  time: string | null;
  description: string;
  category: string | null;
  type: "income" | "expense";
  amount: string;
  /** The account already holds an identical transaction. */
  duplicate: boolean;
}
export interface ImportProblem { line: number; error: string; raw: string }
export interface ImportSummary { records: number; readable: number; duplicates: number; problems: number; skipped: number; income: string; expense: string }
export interface ImportPreview {
  delimiter: string;
  headers: string[];
  mapping: ImportMapping;
  /** True when the date or amount columns could not be found: the user has to choose them. */
  needsMapping: boolean;
  dateOrder: "dmy" | "mdy";
  sample: string[][];
  rows: ImportRow[];
  problems: ImportProblem[];
  summary: ImportSummary;
}
export interface ImportPreviewBody { accountId: string; csv: string; mapping?: ImportMapping; dateOrder?: "dmy" | "mdy" }
export interface ImportCommitBody {
  accountId: string;
  batchKey: string;
  rows: Array<{ day: string; time?: string | null; description: string; category?: string | null; type: "income" | "expense"; amount: string }>;
}

/** Getting-started progress, derived from the person's data. */
export interface Onboarding { accounts: number; transactions: number; dismissed: boolean; complete: boolean; show: boolean }
