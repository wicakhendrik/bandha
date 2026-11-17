"use client";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { ledgerRowView, type AccountLedger } from "@bandha/api-client";
import { AccountModal } from "@/components/account-modal";
import { Icon } from "@/components/icons";
import { AccountLogo, CoinLogo } from "@/components/logos";
import { Shell } from "@/components/shell";
import { EditTransactionModal } from "@/components/transaction-modal";
import { api, errorText, fetcher } from "@/lib/api";
import { accountKindLabel, dateShort, qty, rp } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

const PAGE = 30;

export default function AccountDetailPage() {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const assetId = useSearchParams().get("asset") ?? undefined;
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState(false);
  // Edit and void work on the whole transaction, exactly like on the Transactions page.
  const [confirm, setConfirm] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<{ id: string; text: string } | null>(null);
  const key = `/accounts/${id}/ledger?limit=${limit}${assetId ? `&assetId=${assetId}` : ""}`;
  const { data, error, mutate: reload } = useSWR<AccountLedger>(key, fetcher);

  async function voidTx(txId: string) {
    setRowErr(null);
    try {
      await api(`/transactions/${txId}/void`, { method: "POST", body: {} });
      setConfirm(null);
      await mutate(() => true);
    } catch (e) { setRowErr({ id: txId, text: errorText(e) }); }
  }

  const setAsset = (next?: string) => router.replace(next ? `/accounts/${id}?asset=${next}` : `/accounts/${id}`);
  const back = data?.asset ? { href: `/portfolio/${data.asset.id}`, label: data.asset.symbol } : { href: "/accounts", label: t("accd.back") };

  return (
    <Shell title={data?.account.name ?? t("accd.back")}>
      <p style={{ marginBottom: 16 }}><Link className="iconlink" href={back.href}><Icon name="arrowLeft" size={16} />{back.label}</Link></p>

      {error ? (
        <div className="card"><div className="empty"><b>{t("accd.notFound")}</b>{t("accd.notFoundHint")}<br /><Link className="btn" style={{ marginTop: 12 }} href="/accounts">{t("accd.backToAccounts")}</Link></div></div>
      ) : !data ? (
        <div className="card"><div className="skeleton" style={{ height: 220 }} /></div>
      ) : (
        <>
          <article className="card" style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <AccountLogo account={data.account} size={56} />
                <div>
                  <small className="muted">{accountKindLabel(data.account.kind)}{data.account.includeInNetWorth ? "" : ` · ${t("acc.notCounted")}`}</small>
                  <h2 className="serif" style={{ fontSize: 26, lineHeight: 1.15 }}>{data.account.name}</h2>
                </div>
              </div>
              <div className="accd-side" style={{ textAlign: "right", display: "grid", gap: 8, justifyItems: "end" }}>
                <div>
                  <small className="muted">{t("accd.balance")}</small>
                  <div className="num" style={{ fontSize: 22 }}>{rp(data.totalValue)}</div>
                  {!data.complete && <small className="muted">{t("accd.partial")}</small>}
                </div>
                <button className="btn sm" onClick={() => setEditing(true)}><Icon name="edit" size={14} />{t("accd.edit")}</button>
              </div>
            </div>

            {data.balances.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
                {data.balances.map((b) => (
                  <Link key={b.assetId} href={`/portfolio/${b.assetId}`} className="tag" style={{ display: "inline-flex", alignItems: "center", gap: 8, textDecoration: "none", padding: "5px 12px 5px 6px" }} title={b.symbol}>
                    <CoinLogo symbol={b.symbol} size={22} />
                    <span className="num">{qty(b.quantity)}</span><span>{b.symbol}</span>
                  </Link>
                ))}
              </div>
            )}
          </article>

          {data.balances.length > 1 || data.asset ? (
            <div className="filters" style={{ marginBottom: 14 }} role="group" aria-label={t("accd.filterAria")}>
              <button type="button" className="fchip" aria-pressed={!data.asset} onClick={() => setAsset()}>{t("accd.allAssets")}</button>
              {data.balances.map((b) => (
                <button key={b.assetId} type="button" className="fchip" aria-pressed={data.asset?.id === b.assetId} onClick={() => setAsset(b.assetId)}><CoinLogo symbol={b.symbol} size={18} />{b.symbol}</button>
              ))}
            </div>
          ) : null}

          <article className="card">
            <div className="head"><div><h3>{t("accd.tx")}{data.asset ? ` ${data.asset.symbol}` : ""}</h3><div className="sub">{t("accd.txSub")}</div></div></div>
            {data.rows.length === 0 ? (
              <div className="empty"><b>{t("accd.empty")}</b>{data.asset ? t("accd.emptyAsset", { symbol: data.asset.symbol }) : t("accd.emptyAll")}</div>
            ) : (
              <>
                <div style={{ overflowX: "auto" }}>
                  <table className="txtable">
                    <thead><tr><th>{t("accd.colDesc")}</th><th className="r">{t("accd.colAmount")}</th><th className="r hide-m">{t("accd.colBalance")}</th><th className="r"><span style={{ position: "absolute", left: -9999 }}>{t("tx.colAction")}</span></th></tr></thead>
                    <tbody>
                      {data.rows.map((r) => {
                        const v = ledgerRowView(r);
                        return (
                          <tr key={`${r.transactionId}-${r.assetId}`}>
                            <td className="c-desc"><b>{v.title}</b><br /><small className="muted">{dateShort(r.occurredAt)} · {v.typeLabel}{!data.asset && r.symbol !== "IDR" ? ` · ${r.symbol}` : ""}</small>{rowErr?.id === r.transactionId && <div className="err" role="alert" style={{ marginTop: 8, marginBottom: 0 }}>{rowErr.text}</div>}</td>
                            <td className="r num c-amt"><span className={v.tone}>{v.amount}</span>{v.secondary && <><br /><small className="muted">{v.secondary}</small></>}</td>
                            <td className="r num hide-m">{v.balance}</td>
                            <td className="r c-act" style={{ whiteSpace: "nowrap" }}>
                              {confirm === r.transactionId ? (
                                <span style={{ display: "inline-flex", gap: 6 }}>
                                  <button className="btn sm danger" onClick={() => voidTx(r.transactionId)}>{t("tx.voidConfirm")}</button>
                                  <button className="btn sm" onClick={() => setConfirm(null)}>{t("common.no")}</button>
                                </span>
                              ) : (
                                <span style={{ display: "inline-flex", gap: 6 }}>
                                  {r.editable !== false && <button className="btn sm" onClick={() => setEditId(r.transactionId)} aria-label={t("tx.editAria", { title: v.title })}><Icon name="edit" size={13} />{t("tx.edit")}</button>}
                                  <button className="btn sm" onClick={() => setConfirm(r.transactionId)} aria-label={t("tx.voidAria", { title: v.title })}>{t("tx.void")}</button>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {data.hasMore && <div style={{ textAlign: "center", marginTop: 16 }}><button className="btn" onClick={() => setLimit((l) => l + PAGE)}>{t("common.loadMore")}</button></div>}
              </>
            )}
          </article>
          <p className="hint" style={{ marginTop: 12 }}><button className="link" style={{ background: "none", border: 0, cursor: "pointer", padding: 0 }} onClick={() => reload()}>{t("common.refresh")}</button></p>

          {editId && <EditTransactionModal id={editId} onClose={() => setEditId(null)} />}
          {editing && <AccountModal account={{ ...data.account, balances: [] }} onClose={() => { setEditing(false); void reload(); }} />}
        </>
      )}
    </Shell>
  );
}
