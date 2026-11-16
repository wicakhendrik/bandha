"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { Icon } from "@/components/icons";
import { AccountLogo, CoinLogo } from "@/components/logos";
import { Shell } from "@/components/shell";
import { fetcher } from "@/lib/api";
import { accountKindLabel, assetKindLabel, qty, rp } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Holdings } from "@bandha/api-client";

export default function AssetDetailPage() {
  const { t } = useI18n();
  const { assetId } = useParams<{ assetId: string }>();
  const { data, error, mutate: reload } = useSWR<Holdings>("/holdings", fetcher);
  const asset = data?.assets.find((a) => a.assetId === assetId);

  return (
    <Shell title={asset?.symbol ?? t("pad.back")}>
      <p style={{ marginBottom: 16 }}><Link className="iconlink" href="/portfolio"><Icon name="arrowLeft" size={16} />{t("pad.back")}</Link></p>

      {error ? (
        <div className="card"><div className="empty"><b>{t("pad.loadFail")}</b><button className="btn" style={{ marginTop: 10 }} onClick={() => reload()}>{t("common.retry")}</button></div></div>
      ) : !data ? (
        <div className="card"><div className="skeleton" style={{ height: 180 }} /></div>
      ) : !asset ? (
        <div className="card"><div className="empty"><b>{t("pad.notFound")}</b>{t("pad.notFoundHint")}<br /><Link className="btn" style={{ marginTop: 12 }} href="/portfolio">{t("pad.backTo")}</Link></div></div>
      ) : (
        <>
          <article className="card" style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <CoinLogo symbol={asset.symbol} size={56} />
                <div><small className="muted">{assetKindLabel(asset.kind)}</small><h2 className="serif" style={{ fontSize: 26, lineHeight: 1.1 }}>{asset.symbol}</h2><span className="muted">{asset.name}</span></div>
              </div>
              <div style={{ textAlign: "right" }}>
                <small className="muted">{t("pad.price")}</small>
                <div className="num" style={{ fontSize: 18 }}>{asset.price === null ? t("dash.noPrice") : rp(asset.price)}</div>
                {asset.stale && <small className="muted">{t("dash.stale")}</small>}
              </div>
            </div>
            <div className="grid" style={{ marginTop: 18 }}>
              <div className="c4 stat"><div className="k">{t("pad.total")}</div><div className="v num">{qty(asset.quantity)} <small className="muted">{asset.symbol}</small></div></div>
              <div className="c4 stat"><div className="k">{t("pad.value")}</div><div className="v num">{asset.value === null ? "—" : rp(asset.value)}</div></div>
              <div className="c4 stat"><div className="k">{t("pad.largest")}</div><div className="v" style={{ fontSize: 16 }}>{asset.accounts[0]?.name ?? "—"}</div></div>
            </div>
          </article>

          <article className="card">
            <div className="head"><div><h3>{t("pad.accountsTitle", { symbol: asset.symbol })}</h3><div className="sub">{t("pad.accountsSub", { symbol: asset.symbol })}</div></div></div>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead><tr><th>{t("pad.colAccount")}</th><th className="r">{t("pad.colQty")}</th><th className="r hide-m">{t("pad.colValue")}</th></tr></thead>
                <tbody>
                  {asset.accounts.map((a) => (
                    <tr key={a.accountId}>
                      <td>
                        <Link href={`/accounts/${a.accountId}?asset=${asset.assetId}`} className="rowlink" title={t("pad.viewTx", { symbol: asset.symbol, name: a.name })}>
                          <AccountLogo account={a} size={38} />
                          <span><b className="nm">{a.name}<Icon name="chevronRight" size={15} style={{ color: "var(--muted)" }} /></b><br /><small className="muted">{accountKindLabel(a.kind)}</small></span>
                        </Link>
                      </td>
                      <td className="r num">{qty(a.quantity)}<br /><small className="muted">{asset.symbol}</small></td>
                      <td className="r num hide-m">{a.value === null ? <span className="muted">—</span> : rp(a.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint" style={{ marginTop: 12 }}>{t("pad.count", { n: asset.accounts.length, symbol: asset.symbol })}</p>
          </article>
        </>
      )}
    </Shell>
  );
}
