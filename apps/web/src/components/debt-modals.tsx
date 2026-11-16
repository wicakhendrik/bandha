"use client";
import { useRef, useState } from "react";
import useSWR, { mutate } from "swr";
import { DEBT_KINDS, debtKindLabel, type Account, type Debt, type DebtDirection, type DebtKind } from "@bandha/api-client";
import { api, errorText, fetcher } from "@/lib/api";
import { isAmount, isAmountOrZero, rp, todayKey } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { AccountLogo } from "./logos";
import { Modal } from "./modal";
import { Select, type Option } from "./select";

const NO_ACCOUNT = "none";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const at = (date: string) => new Date(`${date}T12:00:00+07:00`).toISOString();

function useAccountOptions() {
  const { data } = useSWR<{ accounts: Account[] }>("/accounts", fetcher);
  const accounts = data?.accounts ?? [];
  const options: Option[] = accounts.map((a) => ({ value: a.id, label: a.name, icon: <AccountLogo account={a} size={26} />, keywords: a.kind }));
  return { accounts, options, loaded: !!data };
}

/** Opens a new debt (I borrowed) or receivable (I lent). */
export function DebtModal({ onClose, initialDirection = "payable" }: { onClose: () => void; initialDirection?: DebtDirection }) {
  const { t } = useI18n();
  const { accounts, options, loaded } = useAccountOptions();
  const [direction, setDirection] = useState<DebtDirection>(initialDirection);
  const [who, setWho] = useState("");
  const [kind, setKind] = useState<DebtKind>("personal");
  const [principal, setPrincipal] = useState("");
  const [accountId, setAccountId] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(() => todayKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef(`web-${crypto.randomUUID()}`);

  const payable = direction === "payable";
  const effAccount = accountId === NO_ACCOUNT ? NO_ACCOUNT : accounts.some((a) => a.id === accountId) ? accountId : (accounts[0]?.id ?? NO_ACCOUNT);
  const accountOptions: Option[] = [...options, { value: NO_ACCOUNT, label: t("dm.noAccount") }];
  const kindOptions: Option[] = DEBT_KINDS.map((k) => ({ value: k, label: debtKindLabel(k) }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!who.trim()) return setError(t("dm.errName"));
    if (!isAmount(principal)) return setError(t("dm.errAmount"));
    if (due && !DATE_RE.test(due)) return setError(t("dm.errDue"));
    setBusy(true);
    try {
      await api("/debts", {
        method: "POST",
        body: {
          direction, kind, counterparty: who.trim(), principal,
          ...(effAccount !== NO_ACCOUNT ? { accountId: effAccount } : {}),
          ...(due ? { dueDate: due } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          occurredAt: at(date),
          idempotencyKey: key.current,
        },
      });
      await mutate(() => true);
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={t("dm.title")} onClose={onClose}>
      <div className="seg" role="tablist">
        {(["payable", "receivable"] as const).map((d) => (
          <button key={d} type="button" role="tab" aria-selected={direction === d} className={direction === d ? "on" : ""} onClick={() => { setDirection(d); setError(""); }}>{t(`dm.${d}`)}</button>
        ))}
      </div>
      <form onSubmit={submit} noValidate>
        {error && <div className="err" role="alert">{error}</div>}
        <div className="field"><label htmlFor="dw">{payable ? t("dm.whoPayable") : t("dm.whoReceivable")}</label>
          <input id="dw" className="input" value={who} onChange={(e) => setWho(e.target.value)} placeholder={t("dm.whoPlaceholder")} maxLength={80} /></div>
        <div className="field"><label htmlFor="dk">{t("dm.kind")}</label>
          <Select id="dk" value={kind} onChange={(v) => setKind(v as DebtKind)} options={kindOptions} searchable={false} /></div>
        <div className="field"><label htmlFor="dp">{t("dm.principal")}</label>
          <input id="dp" className="input num" inputMode="decimal" value={principal} onChange={(e) => setPrincipal(e.target.value.trim())} placeholder="0" />
          {isAmount(principal) && <span className="hint">{rp(principal)}</span>}</div>
        <div className="field"><label htmlFor="da">{payable ? t("dm.accountPayable") : t("dm.accountReceivable")}</label>
          <Select id="da" value={effAccount} onChange={setAccountId} options={accountOptions} />
          {effAccount === NO_ACCOUNT && <span className="hint">{t("dm.noAccountHint")}</span>}</div>
        <div className="field"><label htmlFor="dd">{t("dm.due")}</label>
          <input id="dd" type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></div>
        <div className="field"><label htmlFor="dn">{t("dm.note")}</label>
          <input id="dn" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></div>
        <div className="field"><label htmlFor="dt">{t("dm.date")}</label>
          <input id="dt" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="foot">
          <button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn pri" disabled={busy || !loaded}>{busy ? t("common.saving") : t("common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Repay (I owe) or receive a payment (owed to me), with optional interest booked separately. */
export function SettleModal({ debt, onClose }: { debt: Debt; onClose: () => void }) {
  const { t } = useI18n();
  const { accounts, options } = useAccountOptions();
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [interest, setInterest] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(() => todayKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef(`web-${crypto.randomUUID()}`);

  const payable = debt.direction === "payable";
  const effAccount = accounts.some((a) => a.id === accountId) ? accountId : (accounts[0]?.id ?? "");
  const total = isAmount(amount) ? Number(amount) + (isAmountOrZero(interest) && interest ? Number(interest) : 0) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!effAccount) return setError(t("sm.errAccount"));
    if (!isAmount(amount)) return setError(t("sm.errAmount"));
    if (Number(amount) > Number(debt.remaining)) return setError(t("sm.errOver", { value: rp(debt.remaining) }));
    if (interest && !isAmountOrZero(interest)) return setError(t("sm.errInterest"));
    setBusy(true);
    try {
      await api(`/debts/${debt.id}/payments`, {
        method: "POST",
        body: {
          accountId: effAccount, amount,
          ...(interest && Number(interest) > 0 ? { interest } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          occurredAt: at(date),
          idempotencyKey: key.current,
        },
      });
      await mutate(() => true);
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={payable ? t("sm.repayTitle") : t("sm.collectTitle")} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        {error && <div className="err" role="alert">{error}</div>}
        <p className="hint" style={{ marginBottom: 14 }}><b>{debt.counterparty}</b> · {t("debt.remaining", { value: rp(debt.remaining) })}</p>
        <div className="field"><label htmlFor="sa">{payable ? t("sm.accountPay") : t("sm.accountCollect")}</label>
          <Select id="sa" value={effAccount} onChange={setAccountId} options={options} /></div>
        <div className="field"><label htmlFor="sm">{t("sm.amount")}</label>
          <input id="sm" className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.trim())} placeholder="0" />
          <span className="hint">
            {isAmount(amount) ? rp(amount) : ""}{" "}
            <button type="button" className="linkbtn" onClick={() => setAmount(debt.remaining.replace(/\.0+$/, ""))}>{t("sm.payAll", { value: rp(debt.remaining) })}</button>
          </span></div>
        <div className="field"><label htmlFor="si">{t("sm.interest")}</label>
          <input id="si" className="input num" inputMode="decimal" value={interest} onChange={(e) => setInterest(e.target.value.trim())} placeholder="0" />
          <span className="hint">{payable ? t("sm.interestPay") : t("sm.interestCollect")}</span></div>
        {total !== null && total > 0 && <p className="hint" style={{ marginBottom: 14 }}>{payable ? t("sm.totalOut", { value: rp(String(total)) }) : t("sm.totalIn", { value: rp(String(total)) })}</p>}
        <div className="field"><label htmlFor="sn">{t("dm.note")}</label>
          <input id="sn" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></div>
        <div className="field"><label htmlFor="sd">{t("dm.date")}</label>
          <input id="sd" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="foot">
          <button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn pri" disabled={busy}>{busy ? t("common.saving") : t("common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Descriptive fields only; the amount and accounts of a posted loan never change. */
export function EditDebtModal({ debt, onClose }: { debt: Debt; onClose: () => void }) {
  const { t } = useI18n();
  const [who, setWho] = useState(debt.counterparty);
  const [kind, setKind] = useState<DebtKind>(debt.kind as DebtKind);
  const [due, setDue] = useState(debt.dueDate ?? "");
  const [note, setNote] = useState(debt.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!who.trim()) return setError(t("dm.errName"));
    if (due && !DATE_RE.test(due)) return setError(t("dm.errDue"));
    setBusy(true);
    try {
      await api(`/debts/${debt.id}`, { method: "PATCH", body: { counterparty: who.trim(), kind, dueDate: due || null, note: note.trim() || null } });
      await mutate(() => true);
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={t("dd.editTitle")} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        {error && <div className="err" role="alert">{error}</div>}
        <div className="field"><label htmlFor="ew">{debt.direction === "payable" ? t("dm.whoPayable") : t("dm.whoReceivable")}</label>
          <input id="ew" className="input" value={who} onChange={(e) => setWho(e.target.value)} maxLength={80} /></div>
        <div className="field"><label htmlFor="ek">{t("dm.kind")}</label>
          <Select id="ek" value={kind} onChange={(v) => setKind(v as DebtKind)} options={DEBT_KINDS.map((k) => ({ value: k, label: debtKindLabel(k) }))} searchable={false} /></div>
        <div className="field"><label htmlFor="ed">{t("dm.due")}</label>
          <input id="ed" type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></div>
        <div className="field"><label htmlFor="en">{t("dm.note")}</label>
          <input id="en" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></div>
        <div className="foot">
          <button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn pri" disabled={busy}>{busy ? t("common.saving") : t("common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}
