"use client";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { debtKindLabel, type Debt, type DebtList } from "@bandha/api-client";
import { DebtModal } from "@/components/debt-modals";
import { DebtProgress } from "@/components/debt-progress";
import { Icon } from "@/components/icons";
import { Shell } from "@/components/shell";
import { fetcher } from "@/lib/api";
import { dateShort, rp, todayKey } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

type Filter = "all" | "payable" | "receivable";

export default function DebtsPage() {
  const { t } = useI18n();
  const { data, error, mutate: reload } = useSWR<DebtList>("/debts", fetcher);
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(false);

  const all = data?.debts ?? [];
  const shown = all.filter((d) => filter === "all" || d.direction === filter);
  const today = todayKey();
  const count = (dir: Debt["direction"]) => all.filter((d) => d.direction === dir && d.status === "open").length;

  return (
    <Shell title={t("debt.title")}>
      <p className="hint" style={{ marginBottom: 16, maxWidth: 640 }}>{t("debt.subtitle")}</p>

      <section className="grid" style={{ marginBottom: 18 }}>
        <article className="card stat c4">
          <div className="k">{t("debt.totalOwe")}</div>
          {data ? <div className="v num neg">{rp(data.totals.payable)}</div> : <div className="skeleton" style={{ height: 28 }} />}
          <small className="muted">{t("debt.active", { n: count("payable") })}</small>
        </article>
        <article className="card stat c4">
          <div className="k">{t("debt.totalOwed")}</div>
          {data ? <div className="v num pos">{rp(data.totals.receivable)}</div> : <div className="skeleton" style={{ height: 28 }} />}
          <small className="muted">{t("debt.active", { n: count("receivable") })}</small>
        </article>
        <article className="card stat c4" style={{ display: "grid", alignContent: "space-between", gap: 10 }}>
          <small className="muted">{t("debt.netNote")}</small>
          <button className="btn pri" onClick={() => setAdding(true)}><Icon name="plus" size={16} />{t("debt.add").replace(/^\+\s*/, "")}</button>
        </article>
      </section>

      <div className="card">
        <div className="seg" role="tablist" aria-label={t("debt.filterAria")} style={{ maxWidth: 420 }}>
          {(["all", "payable", "receivable"] as const).map((f) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
              {f === "all" ? t("debt.fAll") : f === "payable" ? t("debt.fPayable") : t("debt.fReceivable")}
            </button>
          ))}
        </div>

        {error ? (
          <div className="empty"><b>{t("debt.loadFail")}</b><button className="btn" style={{ marginTop: 10 }} onClick={() => reload()}>{t("common.retry")}</button></div>
        ) : !data ? (
          <div className="skeleton" style={{ height: 200 }} />
        ) : all.length === 0 ? (
          <div className="empty"><b>{t("debt.empty")}</b>{t("debt.emptyHint")}<br /><button className="btn pri" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>{t("debt.add")}</button></div>
        ) : shown.length === 0 ? (
          <div className="empty">{t("debt.noMatch")}</div>
        ) : (
          shown.map((d) => {
            const overdue = d.status === "open" && !!d.dueDate && d.dueDate < today;
            return (
              <Link key={d.id} href={`/debts/${d.id}`} className="debtrow" aria-label={`${d.counterparty}, ${t("debt.remaining", { value: rp(d.remaining) })}`}>
                <div className="top2">
                  <div className="who">
                    <b>{d.counterparty}</b>
                    <span className={`tag dir ${d.direction}`}>{d.direction === "payable" ? t("debt.payable") : t("debt.receivable")}</span>
                    <span className="tag">{debtKindLabel(d.kind)}</span>
                    {d.status === "settled" && <span className="tag ok">{t("debt.settled")}</span>}
                  </div>
                  <div className={`num amt ${d.direction === "payable" ? "neg" : "pos"}`}>{d.status === "settled" ? rp("0") : rp(d.remaining)}</div>
                </div>
                <DebtProgress debt={d} />
                <div className="meta">
                  <small className="muted">{t("debt.of", { value: rp(d.principal) })}</small>
                  <small className={overdue ? "neg" : "muted"}>
                    {d.dueDate ? `${overdue ? `${t("debt.overdue")} · ` : ""}${t("debt.due", { date: dateShort(d.dueDate) })}` : t("debt.noDue")}
                  </small>
                </div>
              </Link>
            );
          })
        )}
      </div>

      {adding && <DebtModal onClose={() => setAdding(false)} initialDirection={filter === "receivable" ? "receivable" : "payable"} />}
    </Shell>
  );
}
