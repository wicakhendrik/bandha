"use client";
import Link from "next/link";
import useSWR from "swr";
import { AccountLogo, CoinLogo } from "@/components/logos";
import { Icon } from "@/components/icons";
import { OnboardingGuide } from "@/components/onboarding";
import { Shell } from "@/components/shell";
import { fetcher } from "@/lib/api";
import { assetKindLabel, dateShort, monthLabel, qty, rp } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { balanceText, txView } from "@/lib/txview";
import type { Account, Asset, CashflowMonth, Dashboard, HistoryPoint, Tx } from "@/lib/types";

const SLICE = ["#5C3A21", "#C58A2B", "#5B7A45", "#A8472D", "#8A6D56", "#B9A58C"];

function Sparkline({ points }: { points: HistoryPoint[] }) {
  const { t } = useI18n();
  if (points.length < 2) return <div className="spark-empty">{t("dash.chartEmpty")}</div>;
  const vals = points.map((p) => Number(p.netWorth));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const xy = vals.map((v, i) => [(i / (vals.length - 1)) * 600, 104 - ((v - min) / span) * 92] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const last = xy[xy.length - 1]!;
  return (
    <svg className="spark" viewBox="0 0 600 120" preserveAspectRatio="none" role="img" aria-label={t("dash.chartAria")}>
      <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F0BE5A" stopOpacity=".45" /><stop offset="1" stopColor="#F0BE5A" stopOpacity="0" /></linearGradient></defs>
      <path d={`${line} L600 120 L0 120Z`} fill="url(#sg)" />
      <path d={line} fill="none" stroke="#F4C970" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="5" fill="#FFE7B5" />
    </svg>
  );
}

function Skeleton({ h = 18, w = "100%" }: { h?: number; w?: string }) {
  return <div className="skeleton" style={{ height: h, width: w }} />;
}

export default function DashboardPage() {
  const { t } = useI18n();
  const dash = useSWR<Dashboard>("/dashboard", fetcher);
  const flow = useSWR<{ months: CashflowMonth[] }>("/dashboard/cashflow?months=6", fetcher);
  const hist = useSWR<{ points: HistoryPoint[] }>("/dashboard/history?days=180", fetcher);
  const accs = useSWR<{ accounts: Account[] }>("/accounts", fetcher);
  const txs = useSWR<{ transactions: Tx[] }>("/transactions?limit=5", fetcher);
  const assets = useSWR<{ assets: Asset[] }>("/assets", fetcher);

  const d = dash.data;
  const months = flow.data?.months ?? [];
  const cur = months[months.length - 1];
  const maxFlow = Math.max(1, ...months.flatMap((m) => [Number(m.income), Number(m.expense)]));
  const accountMap = new Map((accs.data?.accounts ?? []).map((a) => [a.id, a]));
  const assetMap = new Map((assets.data?.assets ?? []).map((a) => [a.id, a]));
  const points = hist.data?.points ?? [];
  const change = points.length >= 2 ? Number(points[points.length - 1]!.netWorth) - Number(points[0]!.netWorth) : null;

  let acc = 0;
  const stops = (d?.allocation ?? []).map((a, i) => {
    const from = acc; acc += Number(a.percent);
    return `${SLICE[i % SLICE.length]} ${from}% ${Math.min(acc, 100)}%`;
  });

  if (dash.error) {
    return (
      <Shell>
        <div className="card"><div className="empty"><b>{t("dash.loadFail")}</b>{t("dash.loadFailHint")}<br /><button className="btn" style={{ marginTop: 12 }} onClick={() => dash.mutate()}>{t("common.retry")}</button></div></div>
      </Shell>
    );
  }

  const nonIdr = (d?.holdings ?? []).filter((h) => h.kind !== "fiat");

  return (
    <Shell>
      <div style={{ marginBottom: 18 }}><OnboardingGuide variant="card" /></div>
      {d && !d.complete && <div className="warn" role="status">{t("dash.unpriced", { list: d.unpriced.join(", ") })}</div>}
      <section className="grid">
        <article className="card hero c8">
          <div className="lbl">{t("dash.netWorth")}</div>
          {d ? <div className="big num"><span>Rp</span>{rp(d.netWorth).replace("Rp ", "").replace("−", "-")}</div> : <div style={{ margin: "14px 0" }}><Skeleton h={48} w="70%" /></div>}
          {change !== null && (
            <span className="chip"><Icon name={change >= 0 ? "arrowUp" : "arrowDown"} size={14} /> {rp(String(Math.abs(change)))} {t("dash.since", { date: dateShort(points[0]!.day) })}</span>
          )}
          <Sparkline points={points} />
        </article>

        <div className="stack c4">
          <Link href="/cashflow/income" className="card stat link" aria-label={`${t("dash.incomeMonth")}: ${t("dash.seeDetail")}`}>
            <span className="more"><Icon name="chevronRight" size={18} /></span>
            <div className="k">{t("dash.incomeMonth")}</div>
            {cur ? <div className="v num pos">{rp(cur.income)}</div> : <Skeleton h={28} />}
          </Link>
          <Link href="/cashflow/expense" className="card stat link" aria-label={`${t("dash.expenseMonth")}: ${t("dash.seeDetail")}`}>
            <span className="more"><Icon name="chevronRight" size={18} /></span>
            <div className="k">{t("dash.expenseMonth")}</div>
            {cur ? <div className="v num neg">{rp(cur.expense)}</div> : <Skeleton h={28} />}
          </Link>
        </div>

        <article className="card c5">
          <div className="head"><div><h3>{t("dash.cashflow")}</h3><div className="sub">{t("dash.last6")}</div></div>
            <div className="legend"><span><b style={{ background: "var(--daun)" }} />{t("dash.in")}</span><span><b style={{ background: "var(--gold)" }} />{t("dash.out")}</span></div></div>
          {months.length === 0 ? <Skeleton h={170} /> : (
            <div className="bars" role="img" aria-label={t("dash.cashflowAria")}>
              {months.map((m) => (
                <div className="m" key={m.month}>
                  <div className="pair">
                    <i className="in" style={{ height: `${(Number(m.income) / maxFlow) * 100}%` }} title={`${t("dash.in")} ${rp(m.income)}`} />
                    <i className="out" style={{ height: `${(Number(m.expense) / maxFlow) * 100}%` }} title={`${t("dash.out")} ${rp(m.expense)}`} />
                  </div>
                  <span>{monthLabel(m.month)}</span>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="card c3">
          <div className="head"><div><h3>{t("dash.allocation")}</h3><div className="sub">{t("dash.byValue")}</div></div></div>
          {!d ? <Skeleton h={150} /> : d.allocation.length === 0 ? (
            <div className="empty">{t("dash.noValue")}</div>
          ) : (
            <>
              <div className="donut" style={{ background: `conic-gradient(${stops.join(",")})` }} role="img" aria-label={t("dash.donutAria")}><div><span>{t("dash.kinds", { n: d.allocation.length })}</span></div></div>
              <div className="al">
                {d.allocation.map((a, i) => (
                  <div key={a.key}><span><b style={{ background: SLICE[i % SLICE.length] }} />{assetKindLabel(a.key)}</span><span className="num">{a.percent}%</span></div>
                ))}
              </div>
            </>
          )}
        </article>

        <article className="card c4">
          <div className="head"><div><h3>{t("dash.accounts")}</h3><div className="sub">{accs.data ? t("dash.active", { n: accs.data.accounts.length }) : ""}</div></div><Link className="link" href="/accounts">{t("common.seeAll")}</Link></div>
          {!accs.data ? <Skeleton h={120} /> : accs.data.accounts.length === 0 ? (
            <div className="empty"><b>{t("dash.noAccounts")}</b>{t("dash.noAccountsHint")}<br /><Link className="btn pri" style={{ marginTop: 12 }} href="/accounts">{t("dash.addAccount")}</Link></div>
          ) : accs.data.accounts.slice(0, 4).map((a) => (
            <div className="row" key={a.id}>
              <AccountLogo account={a} size={40} />
              <div className="t"><Link href={`/accounts/${a.id}`} style={{ color: "inherit", textDecoration: "none" }}><b>{a.name}</b></Link></div>
              <div className="a num">{balanceText(a)}</div>
            </div>
          ))}
        </article>

        <article className="card c8">
          <div className="head"><div><h3>{t("dash.recent")}</h3></div><Link className="link" href="/transactions">{t("common.seeAll")}</Link></div>
          {!txs.data ? <Skeleton h={120} /> : txs.data.transactions.length === 0 ? (
            <div className="empty"><b>{t("dash.noTx")}</b>{t("dash.noTxHint")}</div>
          ) : txs.data.transactions.map((tx) => {
            const v = txView(tx, accountMap, assetMap);
            return (
              <div className="row" key={tx.id}>
                <div className="t"><b>{v.title}</b><small>{dateShort(tx.occurredAt)} · {v.accountLabel}</small></div>
                <div className="a"><div className={`num ${v.tone}`}>{v.amount}</div>{v.secondary && <small className="muted num">{v.secondary}</small>}</div>
              </div>
            );
          })}
        </article>

        <article className="card c4">
          <div className="head"><div><h3>{t("dash.nonIdr")}</h3><div className="sub">{t("dash.priceIdr")}</div></div></div>
          {!d ? <Skeleton h={120} /> : nonIdr.length === 0 ? (
            <div className="empty">{t("dash.noNonIdr")}</div>
          ) : nonIdr.map((h) => (
            <div className="row" key={h.assetId}>
              <CoinLogo symbol={h.symbol} size={40} />
              <div className="t"><Link href={`/portfolio/${h.assetId}`} style={{ color: "inherit", textDecoration: "none" }}><b>{h.name}</b></Link><small className="num">{qty(h.quantity)} {h.symbol}</small></div>
              <div className="a">
                <div className="num">{h.value === null ? t("dash.noPrice") : rp(h.value)}</div>
                {h.stale && <small className="muted">{t("dash.stale")}</small>}
              </div>
            </div>
          ))}
        </article>
        <article className="card c12">
          <div className="head"><div><h3>{t("dash.debts")}</h3><div className="sub">{t("dash.debtsSub")}</div></div><Link className="link" href="/debts">{t("common.seeAll")}</Link></div>
          {!d ? <Skeleton h={60} /> : Number(d.debts.payable) === 0 && Number(d.debts.receivable) === 0 ? (
            <div className="empty">{t("dash.debtsEmpty")}<br /><Link className="btn" style={{ marginTop: 12 }} href="/debts">{t("dash.debtsAdd")}</Link></div>
          ) : (
            <div className="debtsum">
              <Link href="/debts" className="stat" style={{ color: "inherit", textDecoration: "none" }}><div className="k">{t("dash.owe")}</div><div className="v num neg">{rp(d.debts.payable)}</div></Link>
              <Link href="/debts" className="stat" style={{ color: "inherit", textDecoration: "none" }}><div className="k">{t("dash.owed")}</div><div className="v num pos">{rp(d.debts.receivable)}</div></Link>
            </div>
          )}
        </article>
      </section>
    </Shell>
  );
}
