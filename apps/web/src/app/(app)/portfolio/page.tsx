"use client";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { Icon } from "@/components/icons";
import { CoinLogo } from "@/components/logos";
import { PALETTE, Pie } from "@/components/pie";
import { Shell } from "@/components/shell";
import { TransactionModal } from "@/components/transaction-modal";
import { fetcher } from "@/lib/api";
import { pct, qty, rp, signedRp } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Portfolio } from "@/lib/types";

const tone = (v: string | null) => (v === null ? "" : Number(v) > 0 ? "pos" : Number(v) < 0 ? "neg" : "");

export default function PortfolioPage() {
  const { t } = useI18n();
  const { data: p, error, mutate: reload } = useSWR<Portfolio>("/portfolio", fetcher);
  const [trade, setTrade] = useState<"buy" | "sell" | null>(null);

  // Allocation by asset (cash included): the six biggest, everything else merged into one slice.
  const valued = (p?.positions ?? []).filter((x) => x.marketValue !== null && Number(x.marketValue) > 0);
  const top = valued.slice(0, 6);
  const rest = valued.slice(6).reduce((s, x) => s + Number(x.marketValue), 0);
  const slices = [
    ...top.map((x) => ({ key: x.assetId, label: x.symbol, value: Number(x.marketValue) })),
    ...(rest > 0 ? [{ key: "others", label: t("pf.others"), value: rest }] : []),
  ];
  const total = slices.reduce((a, x) => a + x.value, 0);

  return (
    <Shell title={t("pf.title")}>
      <div className="head" style={{ marginBottom: 18 }}>
        <p className="muted hide-m">{t("pf.subtitle")}</p>
        <span style={{ display: "flex", gap: 8 }}>
          <button className="btn pri" onClick={() => setTrade("buy")}>{t("pf.buy")}</button>
          <button className="btn" onClick={() => setTrade("sell")}>{t("pf.sell")}</button>
        </span>
      </div>

      {p && !p.complete && <div className="warn" role="status">{t("pf.unpriced", { list: p.unpriced.join(", ") })}</div>}

      <section className="grid">
        <div className="c12 pftop">
        <article className="card pfsum">
          <div className="pfstats">
            {([
              [t("pf.marketValue"), p && rp(p.totals.marketValue), ""],
              [t("pf.cost"), p && rp(p.totals.costBasis), ""],
              [t("pf.unrealized"), p && `${signedRp(p.totals.unrealizedPnl)}${p.totals.unrealizedPct ? ` · ${pct(p.totals.unrealizedPct)}` : ""}`, p ? tone(p.totals.unrealizedPnl) : ""],
              [t("pf.realized"), p && signedRp(p.totals.realizedPnl), p ? tone(p.totals.realizedPnl) : ""],
            ] as const).map(([label, value, tn]) => (
              <div className="pfk" key={label}>
                <div className="k">{label}</div>
                {value ? <div className={`v num ${tn}`}>{value}</div> : <div className="skeleton" style={{ height: 22, marginTop: 6 }} />}
              </div>
            ))}
          </div>
          {p && slices.length > 0 && total > 0 && (
            <div className="pfalloc">
              <div className="k">{t("pf.allocation")}</div>
              <div className="allocbar" role="img" aria-label={t("pf.allocationAria")}>
                {slices.map((x, i) => <i key={x.key} style={{ width: `${(x.value / total) * 100}%`, background: PALETTE[i % PALETTE.length] }} title={`${x.label} ${((x.value / total) * 100).toFixed(1)}%`} />)}
              </div>
              <ul className="alloclegend">
                {slices.map((x, i) => (
                  <li key={x.key}><b style={{ background: PALETTE[i % PALETTE.length] }} />{x.label} <span className="pc">{((x.value / total) * 100).toFixed(1)}%</span></li>
                ))}
              </ul>
            </div>
          )}
        </article>
        {p && slices.length > 0 && total > 0 && (
          <article className="card pfpie">
            <div className="k">{t("pf.allocation")}</div>
            <Pie slices={slices} aria={t("pf.allocationAria")} center={<span>{slices.length}<small>{t("pf.valueShort")}</small></span>} />
          </article>
        )}
        </div>

        <article className="card c12">
          <div className="head"><div><h3>{t("pf.positions")}</h3><div className="sub hide-m">{t("pf.positionsSub")}</div></div></div>
          {error ? (
            <div className="empty"><b>{t("pf.loadFail")}</b><button className="btn" style={{ marginTop: 10 }} onClick={() => reload()}>{t("common.retry")}</button></div>
          ) : !p ? (
            <div className="skeleton" style={{ height: 160 }} />
          ) : p.positions.length === 0 ? (
            <div className="empty"><b>{t("pf.empty")}</b>{t("pf.emptyHint")}</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="pftable">
                <thead>
                  <tr><th>{t("pf.colAsset")}</th><th className="r">{t("pf.colQty")}</th><th className="r hide-m">{t("pf.colAvg")}</th><th className="r hide-m">{t("pf.colPrice")}</th><th className="r">{t("pf.colValue")}</th><th className="r">{t("pf.colPnl")}</th></tr>
                </thead>
                <tbody>
                  {p.positions.map((x) => (
                    <tr key={x.assetId}>
                      <td className="c-asset" style={{ minWidth: 200 }}>
                        <Link href={`/portfolio/${x.assetId}`} title={t("pf.seeAccounts", { symbol: x.symbol })} className="rowlink">
                          <CoinLogo symbol={x.symbol} size={34} />
                          <span>
                            <b className="nm">{x.symbol}<Icon name="chevronRight" size={15} style={{ color: "var(--muted)" }} />{x.cash && <span className="tag" style={{ marginLeft: 6 }}>{t("pf.cash")}</span>}</b><br />
                            <small className="muted">{x.name}{x.accounts.length > 1 ? ` · ${t("pf.accountsN", { n: x.accounts.length })}` : ""}</small>
                          </span>
                        </Link>
                      </td>
                      <td className="r num c-qty">{qty(x.quantity)}<span className="only-m"> {x.symbol}</span></td>
                      <td className="r num hide-m">{x.cash ? "—" : rp(x.avgCost)}</td>
                      <td className="r num hide-m">{x.cash ? "—" : x.price === null ? "—" : rp(x.price)}{x.stale && <><br /><small className="muted">{t("dash.stale")}</small></>}</td>
                      <td className="r num c-val">{x.marketValue === null ? <span className="muted">{t("dash.noPrice")}</span> : rp(x.marketValue)}{!x.cash && <><br /><small className="muted">{t("pf.costOf", { value: rp(x.costBasis) })}</small></>}</td>
                      <td className={`r num c-pnl ${x.cash ? "" : tone(x.unrealizedPnl)}`}>{x.cash || x.unrealizedPnl === null ? "—" : signedRp(x.unrealizedPnl)}{!x.cash && x.unrealizedPct && <><br /><small>{pct(x.unrealizedPct)}</small></>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        {p && p.realized.some((r) => Math.abs(Number(r.realized)) >= 0.5) && (
          <article className="card c12">
            <div className="head"><div><h3>{t("pf.realizedBy")}</h3><div className="sub">{t("pf.realizedBySub")}</div></div></div>
            {p.realized.filter((r) => Math.abs(Number(r.realized)) >= 0.5).map((r) => (
              <div className="row" key={r.symbol}>
                <div className="t"><b>{r.symbol}</b></div>
                <div className={`a num ${tone(r.realized)}`}>{signedRp(r.realized)}</div>
              </div>
            ))}
          </article>
        )}
      </section>
      {trade && <TransactionModal initialType={trade} onClose={() => setTrade(null)} />}
    </Shell>
  );
}
