"use client";
import { useMemo, useRef, useState } from "react";
import useSWR, { mutate } from "swr";
import { PRIORITY_COINS, type EditableTx } from "@bandha/api-client";
import { api, errorText, fetcher } from "@/lib/api";
import { isAmount, isAmountOrZero, qty, rp } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Account, Asset, Portfolio } from "@/lib/types";
import { AccountLogo, CoinLogo } from "./logos";
import { Modal } from "./modal";
import { Select, type Option } from "./select";

type Kind = "expense" | "income" | "transfer" | "buy" | "sell";
const TABS: Kind[] = ["expense", "income", "transfer", "buy", "sell"];
const jakartaDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

/** Ready-made categories, the same ones FinMap offers. The Indonesian name is what gets stored. */
const EXPENSE_CATEGORIES = [
  { id: "Makanan & Minuman", icon: "🍔", en: "Food & Drink" },
  { id: "Belanja & Kebutuhan", icon: "🛒", en: "Shopping & Essentials" },
  { id: "Transportasi", icon: "🚗", en: "Transport" },
  { id: "Tagihan & Utilitas", icon: "⚡", en: "Bills & Utilities" },
  { id: "Hiburan & Rekreasi", icon: "🍿", en: "Entertainment & Leisure" },
  { id: "Kesehatan", icon: "🏥", en: "Health" },
  { id: "Pendidikan & Kerja", icon: "💼", en: "Education & Work" },
  { id: "Biaya Admin & Fee", icon: "💸", en: "Admin & Fees" },
  { id: "Lainnya", icon: "🏷️", en: "Other" },
];
const INCOME_CATEGORIES = [
  { id: "Gaji Pokok", icon: "💼", en: "Salary" },
  { id: "Investasi & Profit", icon: "📈", en: "Investment & Profit" },
  { id: "Bonus & THR", icon: "🎁", en: "Bonus & Holiday pay" },
  { id: "Penjualan / Bisnis", icon: "🏪", en: "Sales / Business" },
  { id: "Cashback & Hadiah", icon: "✨", en: "Cashback & Gifts" },
  { id: "Pengembalian (Refund)", icon: "🔄", en: "Refund" },
  { id: "Lainnya", icon: "🏷️", en: "Other" },
];

const QUICK_PCT = [25, 50, 75, 100];
const trimZeros = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);

/** `pct` percent of `available`, rounded DOWN so it can never exceed what is held. 100% returns the exact balance. */
function share(available: string, pct: number, decimals: number): string {
  if (pct >= 100) return trimZeros(available);
  const f = 10 ** decimals;
  const v = Math.floor((Number(available) * pct / 100) * f + 1e-9) / f;
  return trimZeros(v.toFixed(decimals));
}

/** Loads a posted transaction in form shape, then opens the form on it. */
export function EditTransactionModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useI18n();
  const { data, error } = useSWR<{ transaction: EditableTx }>(`/transactions/${id}`, fetcher, { revalidateOnFocus: false, shouldRetryOnError: false });
  if (data) return <TransactionModal key={data.transaction.id} onClose={onClose} edit={data.transaction} />;
  return (
    <Modal title={t("txm.editTitle")} onClose={onClose}>
      {error ? <div className="err" role="alert">{t("txm.loadFail")}</div> : <div className="skeleton" style={{ height: 160 }} />}
      <div className="foot"><button type="button" className="btn" onClick={onClose}>{t("common.close")}</button></div>
    </Modal>
  );
}

/** Quick-fill buttons: a share of what is available (25%, 50%, 75%, all). */
function QuickShare({ available, decimals, onPick, label }: { available: string; decimals: number; onPick: (v: string) => void; label: string }) {
  const { t } = useI18n();
  if (!(Number(available) > 0)) return null;
  return (
    <div className="quickshare" role="group" aria-label={label}>
      {QUICK_PCT.map((p) => (
        <button key={p} type="button" className="fchip" onClick={() => onPick(share(available, p, decimals))}>{p === 100 ? t("txm.max") : `${p}%`}</button>
      ))}
    </div>
  );
}

export function TransactionModal({ onClose, initialType = "expense", edit }: { onClose: () => void; initialType?: Kind; edit?: EditableTx }) {
  const { t, lang } = useI18n();
  const { data: acc } = useSWR<{ accounts: Account[] }>("/accounts", fetcher);
  const { data: ast } = useSWR<{ assets: Asset[] }>("/assets", fetcher);
  const { data: pf } = useSWR<Portfolio>("/portfolio", fetcher);
  const [type, setType] = useState<Kind | "opening">(edit?.type ?? initialType);
  const [accountId, setAccountId] = useState(edit?.accountId ?? edit?.fromAccountId ?? "");
  const [toId, setToId] = useState(edit?.toAccountId ?? edit?.fundingAccountId ?? edit?.receivingAccountId ?? "");
  const [assetId, setAssetId] = useState(edit?.assetId ?? "");
  // The other side of a buy or sell: the asset it is paid with / received in. Empty = rupiah.
  const [otherId, setOtherId] = useState(edit?.payAssetId ?? edit?.receiveAssetId ?? "");
  const [otherQty, setOtherQty] = useState(edit?.payQuantity ?? edit?.receiveQuantity ?? "");
  const [amount, setAmount] = useState(edit?.quantity ?? "");
  const [fx, setFx] = useState(edit?.functionalAmount ?? "");
  const [total, setTotal] = useState(edit?.totalCost ?? edit?.proceeds ?? "");
  const [fee, setFee] = useState(edit?.fee ?? "");
  const [category, setCategory] = useState(edit?.category ?? "");
  const [description, setDescription] = useState(edit?.description ?? "");
  const [date, setDate] = useState(() => (edit ? jakartaDate(edit.occurredAt) : new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One key per modal session: a retry after a network error can never post twice.
  const key = useRef(`web-${crypto.randomUUID()}`);

  const opening = type === "opening";
  const buy = type === "buy";
  const sell = type === "sell";
  const trade = buy || sell;
  const outflow = type === "expense" || type === "transfer";
  const accounts = acc?.accounts ?? [];
  const held = pf?.positions ?? [];
  const allAssets = ast?.assets ?? [];
  const idr = allAssets.find((a) => a.symbol === "IDR");

  /** What an account holds of an asset right now, plus (when editing) what the edited transaction itself had taken from it. */
  const available = (accountIdArg: string, assetIdArg: string): string => {
    const bal = accounts.find((a) => a.id === accountIdArg)?.balances.find((b) => b.assetId === assetIdArg)?.quantity ?? "0";
    let back = 0;
    if (edit && assetIdArg) {
      if ((edit.type === "expense" || edit.type === "sell") && edit.accountId === accountIdArg && edit.assetId === assetIdArg) back = Number(edit.quantity);
      if (edit.type === "transfer" && edit.fromAccountId === accountIdArg && edit.assetId === assetIdArg) back = Number(edit.quantity);
      if (edit.type === "buy" && edit.fundingAccountId === accountIdArg) {
        if (edit.payAssetId === assetIdArg) back = Number(edit.payQuantity ?? 0) + Number(edit.fee ?? 0);
        else if (!edit.payAssetId && assetIdArg === idr?.id) back = Number(edit.totalCost ?? 0) + Number(edit.fee ?? 0);
      }
    }
    const sum = Number(bal) + back;
    return sum > 0 ? trimZeros(String(Number(sum.toFixed(12)))) : "0";
  };
  /** Assets an account actually holds (quantity above zero). */
  const heldIn = (accountIdArg: string): Asset[] => allAssets.filter((a) => Number(available(accountIdArg, a.id)) > 0);

  // Selling: only accounts that hold something sellable (plus, when editing, the one being edited).
  const fromAccounts = sell ? accounts.filter((a) => a.id === edit?.accountId || held.some((p) => !p.cash && p.accounts.some((h) => h.accountId === a.id))) : accounts;
  const from = fromAccounts.some((a) => a.id === accountId) ? accountId : fromAccounts[0]?.id || "";

  // Which assets can be chosen for the main asset field.
  const assetPool: Asset[] = opening ? allAssets
    : outflow ? [...heldIn(from)].sort((a, b) => Number(b.symbol === "IDR") - Number(a.symbol === "IDR"))
    : sell ? allAssets.filter((a) => a.symbol !== "IDR" && Number(available(from, a.id)) > 0)
    : buy ? allAssets.filter((a) => a.symbol !== "IDR")
    : allAssets;
  const effAsset = opening ? (edit?.assetId ?? "")
    : assetPool.some((a) => a.id === assetId) ? assetId
    : ((trade || outflow) ? assetPool[0]?.id : idr?.id) ?? "";
  const asset = (opening ? allAssets : assetPool).find((a) => a.id === effAsset);

  const to = toId || (trade ? from : accounts.find((a) => a.id !== from)?.id || "");
  const toAccount = trade ? (accounts.some((a) => a.id === to) ? to : from) : to;

  // Other side of a trade. Buy: assets the paying account holds (rupiah included). Sell: any asset, rupiah first.
  const payPool: Asset[] = buy ? heldIn(toAccount).filter((a) => a.id !== effAsset)
    : sell ? [...allAssets.filter((a) => a.symbol === "IDR"), ...allAssets.filter((a) => a.symbol !== "IDR" && a.id !== effAsset)]
    : [];
  const effOther = !trade ? "" : (payPool.some((a) => a.id === otherId) ? otherId : (payPool.find((a) => a.symbol === "IDR") ?? payPool[0])?.id) ?? "";
  const other = payPool.find((a) => a.id === effOther);
  const otherIsIdr = !other || other.symbol === "IDR";

  const availMain = !opening && from && effAsset ? available(from, effAsset) : "0";
  const availPay = buy && toAccount && effOther ? available(toAccount, effOther) : "0";
  const needsFx = !trade && type !== "transfer" && !!asset && asset.symbol !== "IDR";
  const editedAccount = accounts.find((a) => a.id === edit?.accountId);
  const decimalsOf = (a?: Asset) => (!a || a.symbol === "IDR" ? 0 : Math.min(a.decimals ?? 8, 8));

  // Rupiah estimate for the other side of an asset-for-asset trade, from today's price.
  const otherPrice = other && !otherIsIdr ? Number(other.price ?? 0) : 0;
  const estimate = otherPrice > 0 && isAmount(otherQty) ? String(Math.round(Number(otherQty) * otherPrice)) : "";

  const currencyNames = useMemo(() => { try { return new Intl.DisplayNames([lang], { type: "currency" }); } catch { return null; } }, [lang]);
  const accountOpt = (a: Account): Option => ({ value: a.id, label: a.name, icon: <AccountLogo account={a} size={26} />, keywords: a.kind });
  const groupOf = (a: Asset) => (a.kind === "fiat" ? t("accm.currencies") : a.kind === "gold" ? t("accm.goldAsset") : PRIORITY_COINS.includes(a.symbol) ? t("accm.mainCoins") : t("accm.otherCoins"));
  const assetOpt = (a: Asset, holder?: string): Option => {
    const have = holder ? available(holder, a.id) : "0";
    return {
      value: a.id, label: a.symbol, icon: <CoinLogo symbol={a.symbol} size={26} />, keywords: a.name, group: groupOf(a),
      hint: Number(have) > 0 ? t("txm.availableShort", { qty: qty(have) }) : a.kind === "fiat" ? (currencyNames?.of(a.symbol) ?? a.name) : a.name,
    };
  };
  const assetOpts: Option[] = assetPool.map((a) => assetOpt(a, outflow || sell ? from : undefined));
  const otherOpts: Option[] = payPool.map((a) => assetOpt(a, buy ? toAccount : undefined));

  const categories = type === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  const catLabel = (c: { id: string; en: string }) => (lang === "en" ? c.en : c.id);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!opening && !from) return setError(t("txm.errNoAccount"));
    if (!isAmount(amount)) return setError(t("txm.errAmount"));
    if (!opening && !effAsset) return setError(t("txm.noBalance"));
    if ((outflow || sell) && Number(amount) > Number(availMain)) return setError(t("txm.errExceeds", { qty: qty(availMain), symbol: asset?.symbol ?? "" }));
    if (needsFx && !isAmount(fx)) return setError(t("txm.errValue"));
    if (opening && asset && asset.symbol !== "IDR" && !isAmount(fx)) return setError(t("txm.errValue"));
    if (type === "transfer" && (!to || to === from)) return setError(t("txm.errTransfer"));
    if (trade && !other) return setError(t("txm.noPayAsset"));
    if (trade && !otherIsIdr && !isAmount(otherQty)) return setError(t("txm.errOtherQty", { symbol: other?.symbol ?? "" }));
    if (trade && !isAmount(total)) return setError(!otherIsIdr ? t("txm.errValue") : buy ? t("txm.errCost") : t("txm.errProceeds"));
    if (trade && fee && !isAmountOrZero(fee)) return setError(t("txm.errFee"));
    if (buy) {
      const need = otherIsIdr ? Number(total) + Number(fee || 0) : Number(otherQty) + Number(fee || 0);
      if (need > Number(availPay)) return setError(t("txm.errExceeds", { qty: qty(availPay), symbol: other?.symbol ?? "IDR" }));
    }
    setBusy(true);
    try {
      const occurredAt = new Date(`${date}T12:00:00+07:00`).toISOString();
      const meta = { ...(description.trim() ? { description: description.trim() } : {}), occurredAt };
      let body: Record<string, unknown>;
      if (type === "opening") body = { type, quantity: amount, ...(asset && asset.symbol !== "IDR" ? { functionalAmount: fx } : {}), ...meta };
      else {
        const common = { assetId: effAsset, quantity: amount, ...meta, ...(edit ? {} : { idempotencyKey: key.current }) };
        const feeField = fee ? { fee } : {};
        if (buy) body = { type, accountId: from, fundingAccountId: toAccount || from, totalCost: total, ...(otherIsIdr ? {} : { payAssetId: effOther, payQuantity: otherQty }), ...feeField, ...common };
        else if (sell) body = { type, accountId: from, receivingAccountId: toAccount || from, proceeds: total, ...(otherIsIdr ? {} : { receiveAssetId: effOther, receiveQuantity: otherQty }), ...feeField, ...common };
        else if (type === "transfer") body = { type, fromAccountId: from, toAccountId: to, ...common };
        else body = { type, accountId: from, ...(needsFx ? { functionalAmount: fx } : {}), ...(category.trim() ? { category: category.trim() } : {}), ...common };
      }
      await api(edit ? `/transactions/${edit.id}` : "/transactions", { method: edit ? "PUT" : "POST", body });
      await mutate(() => true);
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const unit = trade && amount && isAmount(amount) && isAmount(total) ? rp(String(Number(total) / Number(amount))) : null;
  const noHoldings = outflow && accounts.length > 0 && !!from && assetPool.length === 0;
  const showEstimate = !otherIsIdr && !!estimate && !total;

  return (
    <Modal title={edit ? t("txm.editTitle") : t("txm.title")} onClose={onClose}>
      {edit ? (
        <p className="hint" style={{ marginBottom: 14 }}><span className="tag">{t(`txm.${type}` as const)}</span> {t("txm.typeFixed")}</p>
      ) : (
        <div className="seg" role="tablist">
          {TABS.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={type === k} className={type === k ? "on" : ""} onClick={() => { setType(k); setError(""); setAssetId(""); setOtherId(""); setOtherQty(""); setAmount(""); setTotal(""); setFee(""); }}>{t(`txm.${k}` as const)}</button>
          ))}
        </div>
      )}
      <form onSubmit={submit} noValidate>
        {error && <div className="err" role="alert">{error}</div>}
        {accounts.length === 0 && acc && <div className="warn">{t("txm.noAccounts")}</div>}
        {sell && held.length > 0 && assetPool.length === 0 && <div className="warn">{t("txm.nothingToSell")}</div>}
        {noHoldings && <div className="warn">{t("txm.noBalance")}</div>}

        {opening ? (
          <div className="field">
            <label>{t("txm.account")}</label>
            <div className="row" style={{ padding: "4px 0" }}>
              {editedAccount && <AccountLogo account={editedAccount} size={26} />}
              <div className="t"><b>{editedAccount?.name ?? "…"}</b><small>{asset?.symbol}</small></div>
            </div>
            <span className="hint">{t("txm.fixedHint")}</span>
          </div>
        ) : (
          <>
            <div className="field"><label htmlFor="tf">{type === "transfer" ? t("txm.from") : trade ? t("txm.assetAccount") : t("txm.account")}</label>
              <Select id="tf" value={from} onChange={(v) => { setAccountId(v); setAmount(""); }} options={fromAccounts.map(accountOpt)} /></div>
            {type === "transfer" && (
              <div className="field"><label htmlFor="tt">{t("txm.to")}</label>
                <Select id="tt" value={to} onChange={setToId} options={accounts.filter((a) => a.id !== from).map(accountOpt)} /></div>
            )}
            {trade && (
              <div className="field"><label htmlFor="tt">{buy ? t("txm.paidFrom") : t("txm.receiveTo")}</label>
                <Select id="tt" value={toAccount} onChange={(v) => { setToId(v); setOtherId(""); setOtherQty(""); }} options={accounts.map(accountOpt)} /></div>
            )}
            <div className="field"><label htmlFor="ta">{buy ? t("txm.assetBought") : t("txm.asset")}</label>
              <Select id="ta" value={effAsset} onChange={(v) => { setAssetId(v); setAmount(""); }} options={assetOpts} searchPlaceholder={t("accm.fiatSearch")} /></div>
          </>
        )}
        <div className="field"><label htmlFor="tm">{t("txm.amount")}</label>
          <input id="tm" className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.trim())} placeholder="0" />
          {!trade && !needsFx && !(opening && asset?.symbol !== "IDR") && type !== "transfer" && isAmount(amount) && <span className="hint">{rp(amount)}</span>}
          {(outflow || sell) && effAsset && (
            <>
              <span className="hint">{t("txm.available", { qty: qty(availMain), symbol: asset?.symbol ?? "" })}</span>
              <QuickShare available={availMain} decimals={decimalsOf(asset)} onPick={setAmount} label={t("txm.quickShare")} />
            </>
          )}</div>

        {trade && (
          <>
            <div className="field"><label htmlFor="tw">{buy ? t("txm.payWith") : t("txm.receiveAs")}</label>
              <Select id="tw" value={effOther} onChange={(v) => { setOtherId(v); setOtherQty(""); setTotal(""); }} options={otherOpts} searchPlaceholder={t("accm.fiatSearch")} />
              {buy && payPool.length === 0 && <span className="hint">{t("txm.noPayAsset")}</span>}
              {buy && other && <span className="hint">{t("txm.available", { qty: qty(availPay), symbol: other.symbol })}</span>}</div>

            {!otherIsIdr && (
              <div className="field"><label htmlFor="oq">{(buy ? t("txm.payQty", { symbol: other?.symbol ?? "" }) : t("txm.recvQty", { symbol: other?.symbol ?? "" }))}</label>
                <input id="oq" className="input num" inputMode="decimal" value={otherQty} onChange={(e) => setOtherQty(e.target.value.trim())} placeholder="0" />
                {buy && <QuickShare available={availPay} decimals={decimalsOf(other)} onPick={setOtherQty} label={t("txm.quickShare")} />}</div>
            )}

            <div className="field"><label htmlFor="tot">{!otherIsIdr ? t("txm.valueIdr") : buy ? t("txm.totalCost") : t("txm.totalProceeds")}</label>
              <input id="tot" className="input num" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value.trim())} placeholder={showEstimate ? estimate : "0"} />
              <span className="hint">{isAmount(total) ? rp(total) : t("txm.noFee")}{unit ? ` · ${t("txm.avgPrice", { value: unit })}` : ""}</span>
              {showEstimate && <button type="button" className="linkbtn" onClick={() => setTotal(estimate)}>{t("txm.useEstimate", { value: rp(estimate) })}</button>}</div>

            <div className="field"><label htmlFor="fee">{otherIsIdr ? t("txm.fee") : t("txm.feeIn", { symbol: other?.symbol ?? "" })}</label>
              <input id="fee" className="input num" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value.trim())} placeholder="0" />
              <span className="hint">{t("txm.feeHint")}</span></div>
          </>
        )}
        {(needsFx || (opening && asset && asset.symbol !== "IDR")) && (
          <div className="field"><label htmlFor="tx">{t("txm.valueIdr")}</label>
            <input id="tx" className="input num" inputMode="decimal" value={fx} onChange={(e) => setFx(e.target.value.trim())} placeholder={t("txm.valueIdrPlaceholder")} />
            {isAmount(fx) && <span className="hint">{rp(fx)}</span>}</div>
        )}
        {(type === "income" || type === "expense") && (
          <div className="field"><label htmlFor="tc">{t("txm.category")}</label>
            <div className="catchips" role="group" aria-label={t("txm.categoryQuick")}>
              {categories.map((c) => (
                <button key={c.id} type="button" className="fchip" aria-pressed={category === c.id} onClick={() => setCategory(category === c.id ? "" : c.id)}>
                  <span aria-hidden="true">{c.icon}</span> {catLabel(c)}
                </button>
              ))}
            </div>
            <input id="tc" className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder={t("txm.categoryPlaceholder")} maxLength={60} /></div>
        )}
        <div className="field"><label htmlFor="td">{t("txm.note")}</label>
          <input id="td" className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} /></div>
        <div className="field"><label htmlFor="tdate">{t("txm.date")}</label>
          <input id="tdate" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="foot">
          <button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn pri" disabled={busy || accounts.length === 0 || (sell && assetPool.length === 0) || noHoldings}>{busy ? t("common.saving") : t("common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}
