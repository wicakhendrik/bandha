"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { debtKindLabel, type DebtDetail } from "@bandha/api-client";
import { DebtProgress } from "@/components/debt-progress";
import { EditDebtModal, SettleModal } from "@/components/debt-modals";
import { Icon } from "@/components/icons";
import { AccountLogo } from "@/components/logos";
import { Shell } from "@/components/shell";
import { api, errorText, fetcher } from "@/lib/api";
import { dateShort, rp, todayKey } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function DebtDetailPage() {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error, mutate: reload } = useSWR<DebtDetail>(`/debts/${id}`, fetcher);
  const [settling, setSettling] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<"void" | string | null>(null);
  const [err, setErr] = useState("");

  const d = data?.debt;
  const payable = d?.direction === "payable";
  const overdue = !!d && d.status === "open" && !!d.dueDate && d.dueDate < todayKey();

  async function run(path: string, after?: () => void) {
    setErr("");
    try {
      await api(path, { method: "POST", body: {} });
      setConfirm(null);
      await mutate(() => true);
      after?.();
    } catch (e) { setErr(errorText(e)); }
  }

  return (
    <Shell title={d?.counterparty ?? t("dd.back")}>
      <p style={{ marginBottom: 16 }}><Link className="iconlink" href="/debts"><Icon name="arrowLeft" size={16} />{t("dd.back")}</Link></p>

      {error ? (
        <div className="card"><div className="empty"><b>{t("dd.notFound")}</b>{t("dd.notFoundHint")}<br /><Link className="btn" style={{ marginTop: 12 }} href="/debts">{t("dd.backTo")}</Link>
          <button className="btn" style={{ marginTop: 12, marginLeft: 8 }} onClick={() => reload()}>{t("common.retry")}</button></div></div>
      ) : !d || !data ? (
        <div className="card"><div className="skeleton" style={{ height: 240 }} /></div>
      ) : (
        <>
          <article className="card" style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <span className={`tag dir ${d.direction}`}>{payable ? t("debt.payable") : t("debt.receivable")}</span>
                  <span className="tag">{debtKindLabel(d.kind)}</span>
                  {d.status === "settled" && <span className="tag ok">{t("dd.settledBanner")}</span>}
                </div>
                <h2 className="serif" style={{ fontSize: 26, lineHeight: 1.15 }}>{d.counterparty}</h2>
                {d.note && <p className="muted" style={{ marginTop: 4 }}>{d.note}</p>}
                <small className={overdue ? "neg" : "muted"}>
                  {d.dueDate ? `${overdue ? `${t("debt.overdue")} · ` : ""}${t("debt.due", { date: dateShort(d.dueDate) })}` : t("debt.noDue")}
                </small>
              </div>
              <div style={{ textAlign: "right" }}>
                <small className="muted">{t("dd.remaining")}</small>
                <div className={`num ${payable ? "neg" : "pos"}`} style={{ fontSize: 28 }}>{d.status === "settled" ? rp("0") : rp(d.remaining)}</div>
              </div>
            </div>

            <div style={{ margin: "18px 0 6px" }}><DebtProgress debt={d} /></div>
            <div className="meta">
              <small className="muted">{t("dd.principal")} <b className="num">{rp(d.principal)}</b></small>
              <small className="muted">{t("dd.paid")} <b className="num">{rp(d.paid)}</b> · {t("dd.progress", { pct: Math.round(d.progress) })}</small>
            </div>

            {err && <div className="err" role="alert" style={{ marginTop: 14, marginBottom: 0 }}>{err}</div>}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
              {d.status === "open" && <button className="btn pri" onClick={() => setSettling(true)}>{payable ? t("dd.repay") : t("dd.collect")}</button>}
              <button className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={15} />{t("dd.edit")}</button>
              {confirm === "void" ? (
                <span style={{ display: "inline-flex", gap: 6 }}>
                  <button className="btn danger" onClick={() => run(`/debts/${d.id}/void`, () => router.replace("/debts"))}>{t("dd.voidConfirm")}</button>
                  <button className="btn" onClick={() => setConfirm(null)}>{t("common.no")}</button>
                </span>
              ) : (
                <button className="btn danger" onClick={() => { setErr(""); setConfirm("void"); }}>{t("dd.void")}</button>
              )}
            </div>
            {confirm === "void" && <p className="hint" style={{ marginTop: 10 }}>{t("dd.voidHint")}</p>}
          </article>

          <article className="card">
            <h3>{t("dd.history")}</h3>
            <div className="sub" style={{ marginBottom: 6 }}>{t("dd.historySub")}</div>
            {data.history.map((h) => {
              const opening = h.type === "borrow" || h.type === "lend";
              const label = opening ? (payable ? t("dd.openedPayable") : t("dd.openedReceivable")) : payable ? t("dd.paidPayable") : t("dd.paidReceivable");
              const inflow = h.type === "borrow" || h.type === "collect";
              return (
                <div className="row" key={h.id}>
                  {h.account ? <AccountLogo account={h.account} size={40} /> : <div style={{ width: 40 }} />}
                  <div className="t">
                    <b>{label}</b>
                    <small>
                      {dateShort(h.occurredAt)} · {h.account ? t("dd.viaAccount", { name: h.account.name }) : t("dd.existing")}
                      {Number(h.interest) > 0 ? ` · ${t("dd.interestOf", { value: rp(h.interest) })}` : ""}
                      {h.note ? ` · ${h.note}` : ""}
                    </small>
                    {err && confirm === h.id && <div className="err" role="alert" style={{ marginTop: 8, marginBottom: 0 }}>{err}</div>}
                  </div>
                  <div className="a">
                    <div className={`num ${inflow ? "pos" : "neg"}`}>{inflow ? "+" : "−"}{rp(h.amount)}</div>
                    {!opening && (
                      confirm === h.id ? (
                        <span style={{ display: "inline-flex", gap: 6, marginTop: 4 }}>
                          <button className="btn sm danger" onClick={() => run(`/transactions/${h.id}/void`)}>{t("dd.voidConfirm")}</button>
                          <button className="btn sm" onClick={() => setConfirm(null)}>{t("common.no")}</button>
                        </span>
                      ) : (
                        <button className="btn sm" style={{ marginTop: 4 }} onClick={() => { setErr(""); setConfirm(h.id); }} aria-label={t("dd.undoAria", { value: rp(h.amount) })}>{t("dd.undo")}</button>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </article>

          {settling && <SettleModal debt={d} onClose={() => setSettling(false)} />}
          {editing && <EditDebtModal debt={d} onClose={() => setEditing(false)} />}
        </>
      )}
    </Shell>
  );
}
