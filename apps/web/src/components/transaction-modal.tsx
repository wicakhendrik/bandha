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

export function TransactionModal({ onClose, initialType = "expense", edit }: { onClose: () => void; initialType?: Kind; edit?: EditableTx }) {
  const { t, lang } = useI18n();
  const { data: acc } = useSWR<{ accounts: Account[] }>("/accounts", fetcher);
  const { data: ast } = useSWR<{ assets: Asset[] }>("/assets", fetcher);
  const { data: pf } = useSWR<Portfolio>("/portfolio", fetcher);
  const [type, setType] = useState<Kind | "opening">(edit?.type ?? initialType);
  const [accountId, setAccountId] = useState(edit?.accountId ?? edit?.fromAccountId ?? "");
  const [toId, setToId] = useState(edit?.toAccountId ?? edit?.fundingAccountId ?? edit?.receivingAccountId ?? "");
  const [assetId, setAssetId] = useState(edit?.assetId ?? "");
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
  const trade = type === "buy" || type === "sell";
  const sell = type === "sell";
  const accounts = acc?.accounts ?? [];
  const held = pf?.positions ?? [];
  const idr = (ast?.assets ?? []).find((a) => a.symbol === "IDR");
  // Trades are always against IDR; selling only offers assets that are actually held (plus, when editing, the one being sold).
  const assets = (ast?.assets ?? [])
    .filter((a) => !trade || a.symbol !== "IDR")
    .filter((a) => !sell || a.id === edit?.assetId || held.some((p) => p.assetId === a.id && !p.cash));
  const effAsset = opening ? (edit?.assetId ?? "") : assets.some((a) => a.id === assetId) ? assetId : (trade ? assets[0]?.id : idr?.id) ?? "";
  const asset = (opening ? ast?.assets ?? [] : assets).find((a) => a.id === effAsset);
  const holders = sell ? (held.find((p) => p.assetId === effAsset)?.accounts ?? []) : [];
  const fromAccounts = sell ? accounts.filter((a) => a.id === edit?.accountId || holders.some((h) => h.accountId === a.id)) : accounts;
  const from = fromAccounts.some((a) => a.id === accountId) ? accountId : fromAccounts[0]?.id || "";
  const to = toId || (trade ? from : accounts.find((a) => a.id !== from)?.id || "");
  // Selling: what the account holds now, plus the quantity of the sale being edited (it is put back first).
  const heldNow = holders.find((h) => h.accountId === from)?.quantity;
  const backIn = edit?.type === "sell" && edit.accountId === from && edit.assetId === effAsset ? Number(edit.quantity) : 0;
  const heldHere = heldNow !== undefined || backIn ? String(Number((Number(heldNow ?? 0) + backIn).toFixed(12))) : undefined;
  const needsFx = !trade && !!asset && asset.symbol !== "IDR";
  const editedAccount = accounts.find((a) => a.id === edit?.accountId);

  const currencyNames = useMemo(() => { try { return new Intl.DisplayNames([lang], { type: "currency" }); } catch { return null; } }, [lang]);
  const accountOpt = (a: Account): Option => ({ value: a.id, label: a.name, icon: <AccountLogo account={a} size={26} />, keywords: a.kind });
  const assetOpts: Option[] = useMemo(
    () => assets.map((a) => ({
      value: a.id, label: a.symbol, hint: a.kind === "fiat" ? (currencyNames?.of(a.symbol) ?? a.name) : a.name, icon: <CoinLogo symbol={a.symbol} size={26} />,
      keywords: a.name,
      group: a.kind === "fiat" ? t("accm.currencies") : a.kind === "gold" ? t("accm.goldAsset") : PRIORITY_COINS.includes(a.symbol) ? t("accm.mainCoins") : t("accm.otherCoins"),
    })),
    [assets, currencyNames, lang], // eslint-disable-line react-hooks/exhaustive-deps
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!opening && !from) return setError(t("txm.errNoAccount"));
    if (!isAmount(amount)) return setError(t("txm.errAmount"));
    if (needsFx && !isAmount(fx)) return setError(t("txm.errValue"));
    if (opening && asset && asset.symbol !== "IDR" && !isAmount(fx)) return setError(t("txm.errValue"));
    if (type === "transfer" && (!to || to === from)) return setError(t("txm.errTransfer"));
    if (trade && !isAmount(total)) return setError(type === "buy" ? t("txm.errCost") : t("txm.errProceeds"));
    if (trade && fee && !isAmountOrZero(fee)) return setError(t("txm.errFee"));
    setBusy(true);
    try {
      const occurredAt = new Date(`${date}T12:00:00+07:00`).toISOString();
      const meta = { ...(description.trim() ? { description: description.trim() } : {}), occurredAt };
      let body: Record<string, unknown>;
      if (type === "opening") body = { type, quantity: amount, ...(asset && asset.symbol !== "IDR" ? { functionalAmount: fx } : {}), ...meta };
      else {
        const common = { assetId: effAsset, quantity: amount, ...meta, ...(edit ? {} : { idempotencyKey: key.current }) };
        if (type === "buy") body = { type, accountId: from, fundingAccountId: to || from, totalCost: total, ...(fee ? { fee } : {}), ...common };
        else if (type === "sell") body = { type, accountId: from, receivingAccountId: to || from, proceeds: total, ...(fee ? { fee } : {}), ...common };
        else if (type === "transfer") body = { type, fromAccountId: from, toAccountId: to, ...(needsFx ? { functionalAmount: fx } : {}), ...common };
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

  return (
    <Modal title={edit ? t("txm.editTitle") : t("txm.title")} onClose={onClose}>
      {edit ? (
        <p className="hint" style={{ marginBottom: 14 }}><span className="tag">{t(`txm.${type}` as const)}</span> {t("txm.typeFixed")}</p>
      ) : (
        <div className="seg" role="tablist">
          {TABS.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={type === k} className={type === k ? "on" : ""} onClick={() => { setType(k); setError(""); }}>{t(`txm.${k}` as const)}</button>
          ))}
        </div>
      )}
      <form onSubmit={submit} noValidate>
        {error && <div className="err" role="alert">{error}</div>}
        {accounts.length === 0 && acc && <div className="warn">{t("txm.noAccounts")}</div>}
        {sell && held.length > 0 && assets.length === 0 && <div className="warn">{t("txm.nothingToSell")}</div>}

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
              <Select id="tf" value={from} onChange={setAccountId} options={fromAccounts.map(accountOpt)} /></div>
            {type === "transfer" && (
              <div className="field"><label htmlFor="tt">{t("txm.to")}</label>
                <Select id="tt" value={to} onChange={setToId} options={accounts.filter((a) => a.id !== from).map(accountOpt)} /></div>
            )}
            {trade && (
              <div className="field"><label htmlFor="tt">{type === "buy" ? t("txm.paidFrom") : t("txm.receiveTo")}</label>
                <Select id="tt" value={to} onChange={setToId} options={accounts.map(accountOpt)} /></div>
            )}
            <div className="field"><label htmlFor="ta">{t("txm.asset")}</label>
              <Select id="ta" value={effAsset} onChange={setAssetId} options={assetOpts} searchPlaceholder={t("accm.fiatSearch")} /></div>
          </>
        )}
        <div className="field"><label htmlFor="tm">{t("txm.amount")}</label>
          <input id="tm" className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.trim())} placeholder="0" />
          {!trade && !needsFx && !(opening && asset?.symbol !== "IDR") && isAmount(amount) && <span className="hint">{rp(amount)}</span>}
          {sell && heldHere && <span className="hint">{t("txm.heldHere", { qty: qty(heldHere), symbol: asset?.symbol ?? "" })}</span>}</div>

        {trade && (
          <>
            <div className="field"><label htmlFor="tot">{type === "buy" ? t("txm.totalCost") : t("txm.totalProceeds")}</label>
              <input id="tot" className="input num" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value.trim())} placeholder="0" />
              <span className="hint">{isAmount(total) ? rp(total) : t("txm.noFee")}{unit ? ` · ${t("txm.avgPrice", { value: unit })}` : ""}</span></div>
            <div className="field"><label htmlFor="fee">{t("txm.fee")}</label>
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
            <input id="tc" className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder={t("txm.categoryPlaceholder")} maxLength={60} /></div>
        )}
        <div className="field"><label htmlFor="td">{t("txm.note")}</label>
          <input id="td" className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} /></div>
        <div className="field"><label htmlFor="tdate">{t("txm.date")}</label>
          <input id="tdate" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="foot">
          <button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn pri" disabled={busy || accounts.length === 0 || (sell && assets.length === 0)}>{busy ? t("common.saving") : t("common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}
