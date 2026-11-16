"use client";
import Link from "next/link";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { Icon } from "@/components/icons";
import { Shell } from "@/components/shell";
import { EditTransactionModal } from "@/components/transaction-modal";
import { api, errorText, fetcher } from "@/lib/api";
import { dateShort, txTypeLabel } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { txView } from "@/lib/txview";
import type { Account, Asset, Tx } from "@/lib/types";

const PAGE = 30;

export default function TransactionsPage() {
  const { t } = useI18n();
  const [limit, setLimit] = useState(PAGE);
  const { data, error, mutate: reload } = useSWR<{ transactions: Tx[] }>(`/transactions?limit=${limit}`, fetcher);
  const accs = useSWR<{ accounts: Account[] }>("/accounts", fetcher);
  const assets = useSWR<{ assets: Asset[] }>("/assets", fetcher);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  // Errors belong next to the row the user acted on; a banner at the top is out of sight when scrolled.
  const [rowErr, setRowErr] = useState<{ id: string; text: string } | null>(null);

  const accountMap = new Map((accs.data?.accounts ?? []).map((a) => [a.id, a]));
  const assetMap = new Map((assets.data?.assets ?? []).map((a) => [a.id, a]));

  // Void, not delete: the amount is reversed and the audit trail stays in the ledger.
  async function voidTx(id: string) {
    setRowErr(null);
    try {
      await api(`/transactions/${id}/void`, { method: "POST", body: {} });
      setConfirm(null);
      await mutate(() => true);
    } catch (e) { setRowErr({ id, text: errorText(e) }); }
  }

  return (
    <Shell title={t("tx.title")}>
      <p style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Link className="btn" href="/import"><Icon name="arrowDown" size={15} />{t("imp.button")}</Link>
        <small className="muted">{t("tx.importHint")}</small>
      </p>
      <div className="card">
        {error ? (
          <div className="empty"><b>{t("tx.loadFail")}</b><button className="btn" style={{ marginTop: 10 }} onClick={() => reload()}>{t("common.retry")}</button></div>
        ) : !data ? (
          <div className="skeleton" style={{ height: 200 }} />
        ) : data.transactions.length === 0 ? (
          <div className="empty"><b>{t("tx.empty")}</b>{t("tx.emptyHint")}</div>
        ) : (
          <>
            <table>
              <thead><tr><th>{t("tx.colDesc")}</th><th className="hide-m">{t("tx.colType")}</th><th className="hide-m">{t("tx.colAccount")}</th><th className="r">{t("tx.colAmount")}</th><th className="r"><span style={{ position: "absolute", left: -9999 }}>{t("tx.colAction")}</span></th></tr></thead>
              <tbody>
                {data.transactions.map((tx) => {
                  const v = txView(tx, accountMap, assetMap);
                  return (
                    <tr key={tx.id}>
                      <td><b>{v.title}</b><br /><small className="muted">{dateShort(tx.occurredAt)}</small>{rowErr?.id === tx.id && <div className="err" role="alert" style={{ marginTop: 8, marginBottom: 0 }}>{rowErr.text}</div>}</td>
                      <td className="hide-m"><span className="tag">{txTypeLabel(tx.type)}</span></td>
                      <td className="hide-m">{v.accountLabel}</td>
                      <td className="r"><span className={`num ${v.tone}`}>{v.amount}</span>{v.secondary && <><br /><small className="muted num">{v.secondary}</small></>}</td>
                      <td className="r" style={{ whiteSpace: "nowrap" }}>
                        {confirm === tx.id ? (
                          <span style={{ display: "inline-flex", gap: 6 }}>
                            <button className="btn sm danger" onClick={() => voidTx(tx.id)}>{t("tx.voidConfirm")}</button>
                            <button className="btn sm" onClick={() => setConfirm(null)}>{t("common.no")}</button>
                          </span>
                        ) : (
                          <span style={{ display: "inline-flex", gap: 6 }}>
                            {tx.editable && <button className="btn sm" onClick={() => setEditId(tx.id)} aria-label={t("tx.editAria", { title: v.title })}><Icon name="edit" size={13} />{t("tx.edit")}</button>}
                            <button className="btn sm" onClick={() => setConfirm(tx.id)} aria-label={t("tx.voidAria", { title: v.title })}>{t("tx.void")}</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {data.transactions.length >= limit && (
              <div style={{ textAlign: "center", marginTop: 16 }}><button className="btn" onClick={() => setLimit((l) => l + PAGE)}>{t("common.loadMore")}</button></div>
            )}
            <p className="hint" style={{ marginTop: 14 }}>{t("tx.hint")} {t("tx.editHint")}</p>
          </>
        )}
      </div>
      {editId && <EditTransactionModal id={editId} onClose={() => setEditId(null)} />}
    </Shell>
  );
}
