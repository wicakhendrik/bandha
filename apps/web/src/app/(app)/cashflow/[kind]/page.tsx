"use client";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import type { CashflowDetail } from "@bandha/api-client";
import { Icon } from "@/components/icons";
import { AccountLogo } from "@/components/logos";
import { Pie, type Slice } from "@/components/pie";
import { Shell } from "@/components/shell";
import { fetcher } from "@/lib/api";
import { dateShort, monthYear, rp, shiftMonth, todayKey, txTypeLabel } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

const MAX_SLICES = 7;

export default function CashflowDetailPage() {
  const { t } = useI18n();
  const { kind } = useParams<{ kind: string }>();
  if (kind !== "income" && kind !== "expense") notFound();

  const thisMonth = todayKey().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const { data, error, mutate: reload } = useSWR<CashflowDetail>(`/dashboard/cashflow/${kind}?month=${month}`, fetcher);
  const income = kind === "income";

  // Biggest categories get their own slice; the long tail is merged so the chart stays readable.
  const cats = data?.categories ?? [];
  const slices: Slice[] = [
    ...cats.slice(0, MAX_SLICES).map((c) => ({ key: c.category ?? "none", label: c.category ?? t("cf.uncategorized"), value: Number(c.total) })),
    ...(cats.length > MAX_SLICES ? [{ key: "others", label: t("cf.otherCategories"), value: cats.slice(MAX_SLICES).reduce((s, c) => s + Number(c.total), 0) }] : []),
  ];

  return (
    <Shell title={income ? t("cf.incomeTitle") : t("cf.expenseTitle")}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
        <Link className="iconlink" href="/dashboard"><Icon name="arrowLeft" size={16} />{t("cf.back")}</Link>
        <div className="monthnav" role="group" aria-label={t("cf.monthNav")}>
          <button className="iconbtn" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label={t("cf.prev")}><Icon name="chevronLeft" size={18} /></button>
          <b>{monthYear(month)}</b>
          <button className="iconbtn" onClick={() => setMonth((m) => shiftMonth(m, 1))} disabled={month >= thisMonth} aria-label={t("cf.next")}><Icon name="chevronRight" size={18} /></button>
        </div>
      </div>

      {error ? (
        <div className="card"><div className="empty"><b>{t("cf.loadFail")}</b><button className="btn" style={{ marginTop: 10 }} onClick={() => reload()}>{t("common.retry")}</button></div></div>
      ) : !data ? (
        <div className="card"><div className="skeleton" style={{ height: 240 }} /></div>
      ) : (
        <section className="grid">
          <article className="card c5">
            <div className="k muted" style={{ fontSize: 13 }}>{income ? t("cf.totalIncome") : t("cf.totalExpense")}</div>
            <div className={`num ${income ? "pos" : "neg"}`} style={{ fontSize: 30, margin: "6px 0 2px" }}>{rp(data.total)}</div>
            <small className="muted">{t("cf.count", { n: data.transactions.length })}</small>

            <h3 style={{ marginTop: 22, marginBottom: 12 }}>{t("cf.byCategory")}</h3>
            {slices.length === 0 ? (
              <div className="empty" style={{ padding: "18px 0" }}><b>{income ? t("cf.emptyIncome") : t("cf.emptyExpense")}</b>{t("cf.emptyHint")}</div>
            ) : (
              <Pie slices={slices} aria={t("cf.donutAria")} valueText={(s) => rp(String(s.value))} center={<span>{cats.length}<small>{t("cf.categoryShort")}</small></span>} />
            )}
          </article>

          <article className="card c7">
            <div className="head"><div><h3>{t("cf.transactions")}</h3><div className="sub">{monthYear(month)}</div></div></div>
            {data.transactions.length === 0 ? (
              <div className="empty"><b>{income ? t("cf.emptyIncome") : t("cf.emptyExpense")}</b>{t("cf.emptyHint")}</div>
            ) : (
              data.transactions.map((tx) => {
                // A fee that belongs to a purchase or a sale is shown as such, not under the asset's own description.
                const title = tx.type === "buy" || tx.type === "sell" ? t("cf.feeOf", { type: txTypeLabel(tx.type).toLowerCase() }) : tx.description || tx.category || txTypeLabel(tx.type);
                return (
                  <div className="row" key={`${tx.id}-${tx.amount}`}>
                    {tx.account ? <AccountLogo account={tx.account} size={38} /> : <span style={{ width: 38 }} />}
                    <div className="t">
                      <b>{title}</b>
                      <small>{dateShort(tx.occurredAt)}{tx.account ? ` · ${tx.account.name}` : ""}{tx.category && tx.category !== title ? ` · ${tx.category}` : ""}</small>
                    </div>
                    <div className={`a num ${income ? "pos" : "neg"}`}>{income ? "+" : "−"}{rp(tx.amount)}</div>
                  </div>
                );
              })
            )}
          </article>
        </section>
      )}
    </Shell>
  );
}
