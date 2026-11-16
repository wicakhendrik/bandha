import { KIND_OF_CATEGORY, guessBrand } from "@bandha/api-client";
import { dec } from "@bandha/ledger";
import type { FmAccount, FmData, FmDebt, FmEntry, FmLedgerAccount, FmTransaction } from "./finmap-source";

/**
 * Turns FinMap data into a list of Bandha-level steps. Pure: no database, so every mapping decision can be tested.
 *
 * Why steps and not copied journals: FinMap's ledger and its balance projection disagree in places (for example a
 * conversion fee is booked to the ledger without touching the account). What people saw and trusted in FinMap is each
 * account's balance, so the steps replay the user's *commands* through Bandha's own rules (weighted-average cost,
 * balanced journals, no negative holdings) and the result is reconciled against FinMap's balances afterwards.
 */

export type BandhaAssetKind = "fiat" | "crypto" | "gold" | "stock" | "fund" | "other";

export interface PlanAsset { fmId: string; symbol: string; name: string; kind: BandhaAssetKind; decimals: number; providerRef: string | null; factor: string }
export interface PlanAccount { fmId: string; name: string; kind: string; brandKey: string | null; includeInNetWorth: boolean; archived: boolean; createdAt: Date }

interface Base { ref: string; at: Date; description: string | null }
export type Step =
  | (Base & { k: "opening"; account: string; asset: string; quantity: string; unitCost: string | null })
  | (Base & { k: "income" | "expense"; account: string; asset: string; quantity: string; functionalAmount: string; category: string | null })
  | (Base & { k: "transfer"; from: string; to: string; asset: string; quantity: string })
  | (Base & { k: "buy"; account: string; funding: string; asset: string; quantity: string; totalCost: string })
  | (Base & { k: "sell"; account: string; receiving: string; asset: string; quantity: string; proceeds: string });

export interface PlanDebt {
  ref: string; direction: "payable" | "receivable"; kind: string; counterparty: string; principal: string; dueDate: string | null; note: string;
}
export interface Skipped { ref: string; what: string; reason: string }
export interface ExpectedBalance { account: string; asset: string; quantity: string }

export interface Plan {
  user: { email: string; name: string; passwordHash: string | null };
  workspace: { name: string; currency: string };
  assets: PlanAsset[];
  accounts: PlanAccount[];
  steps: Step[];
  debts: PlanDebt[];
  expected: ExpectedBalance[];
  warnings: string[];
  skipped: Skipped[];
  /** Things that must be decided before anything can be migrated. */
  blockers: string[];
}

export interface PlanOptions { goldUnit?: "gram" | "ounce" }

const OUNCE = "31.1034768";
const num = (v: unknown): string | null => (typeof v === "string" && /^\d+(\.\d+)?$/.test(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const isZero = (v: string | null | undefined) => v === null || v === undefined || dec(v).isZero();
const cap = (s: string, n: number) => s.trim().replace(/\s+/g, " ").slice(0, n);

/* ───────── assets ───────── */

function assetKind(type: string, symbol: string): BandhaAssetKind {
  switch (type) {
    case "fiat": return "fiat";
    case "crypto": return "crypto";
    case "commodity": return symbol.toUpperCase() === "XAU" ? "gold" : "other";
    case "stock": return "stock";
    case "fund": case "etf": case "mutual_fund": return "fund";
    default: return "other";
  }
}

/* ───────── accounts ───────── */

export function accountKind(sourceType: string, accountType: string, defaultAssetKind: BandhaAssetKind | null): string {
  switch (accountType) {
    case "checking": case "savings": return "bank";
    case "exchange": return "exchange";
    case "brokerage": return "brokerage";
    case "wallet": return defaultAssetKind === "crypto" ? "wallet" : "ewallet";
    case "credit": case "loan": return "other";
    default:
      switch (sourceType) {
        case "bank": return "bank";
        case "exchange": return "exchange";
        case "wallet": return defaultAssetKind === "crypto" ? "wallet" : "ewallet";
        case "brokerage": return "brokerage";
        default: return "other";
      }
  }
}

/** "BCA" + "Tabungan" -> "BCA Tabungan", but "BCA" + "BCA Utama" stays "BCA Utama" and "GoPay" + "GoPay" stays "GoPay". */
export function accountName(source: string, account: string): string {
  const s = source.trim();
  const a = account.trim();
  if (!s) return cap(a, 80);
  if (a.toLowerCase().includes(s.toLowerCase())) return cap(a, 80);
  if (s.toLowerCase().includes(a.toLowerCase())) return cap(s, 80);
  return cap(`${s} ${a}`, 80);
}

/* ───────── debts ───────── */

const DEBT_KIND: Record<string, string> = { credit_card: "credit_card", mortgage: "mortgage", installment: "installment", personal_loan: "personal", receivable: "personal" };
const jakartaDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(d);

function planDebt(d: FmDebt, skipped: Skipped[]): PlanDebt | null {
  if (d.status === "paid_off" || d.status === "written_off") { skipped.push({ ref: d.id, what: `utang "${d.name}"`, reason: `status ${d.status}, tidak dimigrasi` }); return null; }
  if (dec(d.remainingBalance).lte(0)) { skipped.push({ ref: d.id, what: `utang "${d.name}"`, reason: "sisa nol" }); return null; }
  const due = d.nextPaymentDate ?? d.maturityDate;
  const rate = d.interestRate && !dec(d.interestRate).isZero() ? ` Bunga ${dec(d.interestRate).toFixed()}% per tahun.` : "";
  return {
    ref: d.id,
    direction: d.direction === "receivable" ? "receivable" : "payable",
    kind: DEBT_KIND[d.contractType] ?? "other",
    counterparty: cap(d.name, 80) || "Tanpa nama",
    principal: dec(d.remainingBalance).toFixed(),
    dueDate: due ? jakartaDay(due) : null,
    note: cap(`Dari FinMap. Pokok awal Rp ${dec(d.principalAmount).toFixed()}, dimigrasi sebesar sisa.${rate}`, 200),
  };
}

/* ───────── transactions ───────── */

interface Ctx {
  data: FmData;
  assetById: Map<string, PlanAsset>;
  accountIds: Set<string>;
  ledger: Map<string, FmLedgerAccount>;
  entriesByJournal: Map<string, FmEntry[]>;
  fnAssetId: string | null;
  steps: Step[];
  skipped: Skipped[];
  warnings: string[];
  used: Set<string>;
}

const qty = (c: Ctx, assetId: string, q: string): string => {
  c.used.add(assetId);
  const a = c.assetById.get(assetId);
  return a && a.factor !== "1" ? dec(q).times(a.factor).toFixed() : dec(q).toFixed();
};
const isFn = (c: Ctx, assetId: string) => assetId === c.fnAssetId;

/** What a transaction is, read from the entries of its live journal. Used when the stored command is not usable. */
function fromJournal(c: Ctx, t: FmTransaction, at: Date): boolean {
  const entries = (t.journalId ? c.entriesByJournal.get(t.journalId) : undefined) ?? [];
  const rows = entries.filter((e) => e.quantity !== null && !dec(e.quantity).isZero()).map((e) => ({ e, l: c.ledger.get(e.ledgerAccountId) }));
  const category = t.category ?? null;
  if (rows.length !== 2 || rows.some((r) => !r.l)) return false;
  const pair = rows as Array<{ e: FmEntry; l: FmLedgerAccount }>;
  const debit = pair.find((r) => r.e.direction === "debit");
  const credit = pair.find((r) => r.e.direction === "credit");
  if (!debit || !credit) return false;
  const asset = debit.e.assetId ?? credit.e.assetId;
  const quantity = debit.e.quantity!;
  if (!asset || !c.assetById.has(asset)) return false;
  const base = { ref: t.id, at, description: t.description };
  const fa = dec(debit.e.functionalAmount).toFixed();

  if (debit.l.category === "asset" && credit.l.category === "income" && debit.l.accountId && c.accountIds.has(debit.l.accountId)) {
    c.steps.push({ ...base, k: "income", account: debit.l.accountId, asset, quantity: qty(c, asset, quantity), functionalAmount: fa, category: category ?? credit.l.name.replace(/^Income:/, "") });
    return true;
  }
  if (debit.l.category === "expense" && credit.l.category === "asset" && credit.l.accountId && c.accountIds.has(credit.l.accountId)) {
    c.steps.push({ ...base, k: "expense", account: credit.l.accountId, asset, quantity: qty(c, asset, quantity), functionalAmount: fa, category: category ?? debit.l.name.replace(/^Expense:/, "") });
    return true;
  }
  if (debit.l.category === "asset" && credit.l.category === "asset" && debit.l.accountId && credit.l.accountId && debit.l.accountId !== credit.l.accountId
    && debit.e.assetId === credit.e.assetId && c.accountIds.has(debit.l.accountId) && c.accountIds.has(credit.l.accountId)) {
    c.steps.push({ ...base, k: "transfer", from: credit.l.accountId, to: debit.l.accountId, asset, quantity: qty(c, asset, quantity) });
    return true;
  }
  return false;
}

function planTransaction(c: Ctx, t: FmTransaction): void {
  const at = t.occurredAt ?? t.createdAt;
  const s = (t.snapshot ?? {}) as Record<string, unknown>;
  const type = str(s["transactionType"]) ?? t.transactionType;
  const base = { ref: t.id, at, description: t.description };
  const known = (accountId: string | null, assetId: string | null) => !!accountId && !!assetId && c.accountIds.has(accountId) && c.assetById.has(assetId);
  const skip = (reason: string): void => { c.skipped.push({ ref: t.id, what: `${t.transactionType} ${at.toISOString().slice(0, 10)}${t.description ? ` "${cap(t.description, 40)}"` : ""}`, reason }); };

  /** Fee booked as its own expense on the paying account, in the asset it was paid in. */
  const fee = (account: string, assetId: string | null, quantity: unknown, functionalAmount: unknown, label: string) => {
    const q = num(quantity);
    if (isZero(q)) return;
    if (!assetId || !c.assetById.has(assetId)) {
      c.warnings.push(`Biaya ${label} (${q}) pada transaksi ${t.id} tidak punya aset, jadi tidak dimigrasi (di FinMap biaya itu tidak mengubah saldo rekening).`);
      return;
    }
    c.steps.push({ ...base, k: "expense", account, asset: assetId, quantity: qty(c, assetId, q!), functionalAmount: num(functionalAmount) ?? "0", category: label, description: label });
  };

  if (type === "opening_balance") {
    const accountId = str(s["accountId"]);
    const items = Array.isArray(s["items"]) ? (s["items"] as Array<Record<string, unknown>>) : [];
    if (!accountId || !c.accountIds.has(accountId) || items.length === 0) return skip("saldo awal tanpa rekening atau isi yang bisa dibaca");
    for (const it of items) {
      const assetId = str(it["assetId"]);
      const q = num(it["quantity"]);
      if (!assetId || !c.assetById.has(assetId) || !q) { skip("item saldo awal tidak valid"); continue; }
      if (isZero(q)) continue;
      const a = c.assetById.get(assetId)!;
      // FinMap books a foreign-currency opening at face value in rupiah (100 USD = Rp 100): not a real cost, so it is re-estimated.
      const unit = a.kind === "fiat" ? null : num(it["costBasisFunctional"]);
      c.steps.push({ ...base, k: "opening", account: accountId, asset: assetId, quantity: qty(c, assetId, q), unitCost: unit && !isZero(unit) ? dec(unit).div(dec(a.factor)).toFixed() : null, description: t.description ?? "Saldo awal" });
    }
    return;
  }

  if (type === "income" || type === "expense") {
    const accountId = str(s["accountId"]);
    const assetId = str(s["assetId"]);
    const q = num(s["quantity"]);
    if (known(accountId, assetId) && q && !isZero(q)) {
      c.steps.push({
        ...base, k: type, account: accountId!, asset: assetId!, quantity: qty(c, assetId!, q), functionalAmount: num(s["functionalAmount"]) ?? "0",
        category: t.category ?? str(s["category"]),
      });
      return;
    }
  } else if (type === "transfer") {
    const from = str(s["sourceAccountId"]);
    const to = str(s["destinationAccountId"]);
    const assetId = str(s["assetId"]);
    const q = num(s["quantity"]);
    if (known(from, assetId) && to && c.accountIds.has(to) && q && !isZero(q) && from !== to) {
      c.steps.push({ ...base, k: "transfer", from: from!, to, asset: assetId!, quantity: qty(c, assetId!, q) });
      fee(from!, str(s["feeAssetId"]) ?? assetId, s["feeQuantity"], s["feeFunctionalAmount"], "Biaya transfer");
      return;
    }
  } else if (type === "conversion") {
    const srcAcc = str(s["sourceAccountId"]);
    const dstAcc = str(s["destinationAccountId"]);
    const srcAsset = str(s["sourceAssetId"]);
    const dstAsset = str(s["destinationAssetId"]);
    const srcQ = num(s["sourceQuantity"]);
    const dstQ = num(s["destinationQuantity"]);
    if (known(srcAcc, srcAsset) && known(dstAcc, dstAsset) && srcQ && dstQ && !isZero(srcQ) && !isZero(dstQ)) {
      const feeParts = [str(s["feeAssetId"]), s["feeQuantity"], s["feeFunctionalAmount"]] as const;
      if (srcAsset === dstAsset) {
        if (srcAcc !== dstAcc) c.steps.push({ ...base, k: "transfer", from: srcAcc!, to: dstAcc!, asset: srcAsset!, quantity: qty(c, srcAsset!, srcQ) });
      } else if (isFn(c, srcAsset!)) {
        // Rupiah in, something else out: a purchase.
        c.steps.push({ ...base, k: "buy", account: dstAcc!, funding: srcAcc!, asset: dstAsset!, quantity: qty(c, dstAsset!, dstQ), totalCost: dec(num(s["sourceFunctionalAmount"]) ?? srcQ).toFixed() });
      } else if (isFn(c, dstAsset!)) {
        // Something sold for rupiah.
        c.steps.push({ ...base, k: "sell", account: srcAcc!, receiving: dstAcc!, asset: srcAsset!, quantity: qty(c, srcAsset!, srcQ), proceeds: dec(dstQ).toFixed() });
      } else {
        // Swap between two non-rupiah assets: sell one for rupiah and buy the other with the same rupiah, so no rupiah is left behind.
        const value = dec(num(s["destinationFunctionalAmount"]) ?? num(s["sourceFunctionalAmount"]) ?? "0").toFixed();
        if (isZero(value)) { skip("konversi antar aset tanpa nilai rupiah"); return; }
        c.steps.push({ ...base, k: "sell", account: srcAcc!, receiving: dstAcc!, asset: srcAsset!, quantity: qty(c, srcAsset!, srcQ), proceeds: value, description: t.description ?? "Konversi (jual)" });
        c.steps.push({ ...base, k: "buy", account: dstAcc!, funding: dstAcc!, asset: dstAsset!, quantity: qty(c, dstAsset!, dstQ), totalCost: value, description: t.description ?? "Konversi (beli)" });
      }
      fee(srcAcc!, feeParts[0], feeParts[1], feeParts[2], "Biaya konversi");
      return;
    }
  } else if (!fromJournal(c, t, at)) {
    return skip(`jenis transaksi "${type}" belum didukung`);
  } else {
    return;
  }

  // The stored command could not be used (for example an edit stored as raw entries): read the live journal instead.
  if (!fromJournal(c, t, at)) skip("data transaksi tidak lengkap dan jurnalnya tidak dikenali");
}

/* ───────── the plan ───────── */

export function buildPlan(data: FmData, options: PlanOptions = {}): Plan {
  const warnings: string[] = [];
  const skipped: Skipped[] = [];
  const blockers: string[] = [];

  const currency = data.workspace.currencyCode;
  if (currency !== "IDR") blockers.push(`Mata uang workspace FinMap adalah ${currency}. Bandha saat ini hanya mendukung IDR.`);
  if (data.otherMembers > 0) warnings.push(`Workspace ini dipakai ${data.otherMembers + 1} orang di FinMap. Bandha satu orang per buku besar, jadi hanya data ${data.owner.email} yang dimigrasi.`);
  if (!data.owner.passwordHash) warnings.push("Akun ini tidak punya kata sandi di FinMap (mungkin masuk lewat Google). Gunakan \"Lupa kata sandi\" di Bandha untuk membuat kata sandi.");
  for (const [status, n] of Object.entries(data.notPosted)) warnings.push(`${n} transaksi berstatus "${status}" tidak dimigrasi (tidak memengaruhi saldo).`);

  const fn = data.assets.find((a) => a.type === "fiat" && (a.fiatCurrencyCode ?? a.symbol) === currency) ?? null;
  const assets: PlanAsset[] = data.assets.map((a) => {
    const kind = assetKind(a.type, a.symbol);
    const gold = kind === "gold";
    return {
      fmId: a.id, symbol: (kind === "fiat" ? (a.fiatCurrencyCode ?? a.symbol) : a.symbol).toUpperCase(), name: a.name, kind, decimals: a.decimals,
      providerRef: kind === "crypto" ? a.coingeckoId : null, factor: gold && options.goldUnit === "ounce" ? OUNCE : "1",
    };
  });
  const assetById = new Map(assets.map((a) => [a.fmId, a]));

  const sourceOf = new Map(data.sources.map((s) => [s.id, s]));
  const accounts: PlanAccount[] = data.accounts.map((a: FmAccount) => {
    const src = sourceOf.get(a.financialSourceId);
    const name = accountName(src?.name ?? "", a.name);
    const defaultKind = a.defaultAssetId ? (assetById.get(a.defaultAssetId)?.kind ?? null) : null;
    let kind = accountKind(src?.type ?? "other", a.accountType, defaultKind);
    const brand = guessBrand(name) ?? guessBrand(src?.name ?? "");
    if (kind === "other" && brand && a.accountType !== "credit" && a.accountType !== "loan") kind = KIND_OF_CATEGORY[brand.category];
    if (a.accountType === "credit" || a.accountType === "loan") warnings.push(`Rekening "${name}" bertipe ${a.accountType} di FinMap, dimigrasi sebagai rekening biasa ("Lainnya").`);
    return { fmId: a.id, name, kind, brandKey: brand?.key ?? null, includeInNetWorth: a.includeInNetWorth, archived: a.archivedAt !== null || (src?.archivedAt ?? null) !== null, createdAt: a.openedAt };
  });

  const entriesByJournal = new Map<string, FmEntry[]>();
  for (const e of data.entries) (entriesByJournal.get(e.journalId) ?? entriesByJournal.set(e.journalId, []).get(e.journalId)!).push(e);

  const c: Ctx = {
    data, assetById, accountIds: new Set(accounts.map((a) => a.fmId)), ledger: new Map(data.ledgerAccounts.map((l) => [l.id, l])),
    entriesByJournal, fnAssetId: fn?.id ?? null, steps: [], skipped, warnings, used: new Set(),
  };
  for (const t of data.transactions) planTransaction(c, t);

  // Openings first (they are the starting point), everything else in the order it happened.
  const ordered = [...c.steps.filter((s) => s.k === "opening"), ...c.steps.filter((s) => s.k !== "opening")];

  const expected: ExpectedBalance[] = data.balances
    .filter((b) => c.accountIds.has(b.accountId) && assetById.has(b.assetId) && !dec(b.quantity).isZero())
    .map((b) => ({ account: b.accountId, asset: b.assetId, quantity: qty(c, b.assetId, b.quantity) }));

  const goldUsed = [...c.used].some((id) => assetById.get(id)?.kind === "gold");
  if (goldUsed && !options.goldUnit) {
    blockers.push("Ada emas (XAU) di data FinMap, dan satuannya tidak tercatat di sana. Tentukan --gold-unit=gram atau --gold-unit=ounce (1 ounce troy = 31,1034768 gram; Bandha menyimpan emas dalam gram).");
  }
  for (const a of assets) {
    if (!c.used.has(a.fmId)) continue;
    if (a.kind === "other" || a.kind === "stock" || a.kind === "fund") warnings.push(`Aset ${a.symbol} (${a.kind}) belum punya sumber harga di Bandha, jadi nilainya tampil "belum ada harga".`);
  }

  const debts = data.debts.flatMap((d) => { const p = planDebt(d, skipped); return p ? [p] : []; });
  if (debts.length > 0) warnings.push(`${debts.length} utang/piutang dimigrasi sebagai kontrak yang sudah ada (tanpa rekening), sebesar sisa. Berbeda dengan FinMap, Bandha memasukkannya ke kekayaan bersih.`);

  return {
    user: { email: data.owner.email.toLowerCase(), name: cap(data.owner.email.split("@")[0] ?? "Pengguna", 80) || "Pengguna", passwordHash: data.owner.passwordHash },
    workspace: { name: cap(data.workspace.name, 80) || "Personal finance", currency },
    assets: assets.filter((a) => c.used.has(a.fmId) || data.accounts.some((x) => x.defaultAssetId === a.fmId) || data.balances.some((b) => b.assetId === a.fmId)),
    accounts, steps: ordered, debts, expected, warnings, skipped, blockers,
  };
}
