"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import useSWR, { mutate } from "swr";
import { AccountModal } from "@/components/account-modal";
import { Icon } from "@/components/icons";
import { AccountLogo } from "@/components/logos";
import { Shell } from "@/components/shell";
import { api, errorText, fetcher } from "@/lib/api";
import { ACCOUNT_FILTERS, accountKindLabel } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { balanceText } from "@/lib/txview";
import type { Account } from "@/lib/types";

export default function AccountsPage() {
  const { t } = useI18n();
  const { data, error, mutate: reload } = useSWR<{ accounts: Account[] }>("/accounts", fetcher);
  const [modal, setModal] = useState<"add" | Account | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState("");

  const accounts = data?.accounts ?? [];

  // Only types that actually exist get a filter chip, with how many accounts each has.
  const chips = useMemo(
    () => ACCOUNT_FILTERS.map((f) => ({ ...f, count: accounts.filter((a) => f.kinds.includes(a.kind)).length })).filter((f) => f.count > 0),
    [accounts],
  );

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const kinds = ACCOUNT_FILTERS.find((f) => f.key === filter)?.kinds;
    return accounts.filter((a) => (!kinds || kinds.includes(a.kind)) && (!q || `${a.name} ${accountKindLabel(a.kind)}`.toLowerCase().includes(q)));
  }, [accounts, filter, search]);

  async function archive(id: string) {
    setMsg("");
    try {
      await api(`/accounts/${id}/archive`, { method: "POST", body: {} });
      setConfirm(null);
      await mutate(() => true);
    } catch (e) { setMsg(errorText(e)); }
  }

  return (
    <Shell title={t("acc.title")}>
      <div className="head" style={{ marginBottom: 18 }}>
        <p className="muted">{t("acc.subtitle")}</p>
        <button className="btn pri" onClick={() => setModal("add")}>{t("acc.add")}</button>
      </div>
      {msg && <div className="err" role="alert">{msg}</div>}

      {accounts.length > 0 && (
        <div className="toolbar">
          <div className="searchbox">
            <Icon name="search" size={16} />
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("acc.search")} aria-label={t("acc.searchAria")} />
          </div>
        </div>
      )}
      {chips.length > 1 && (
        <div className="filters" role="group" aria-label={t("acc.filterAria")} style={{ marginBottom: 14 }}>
          <button type="button" className="fchip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>{t("common.all")} <small>{accounts.length}</small></button>
          {chips.map((c) => (
            <button key={c.key} type="button" className="fchip" aria-pressed={filter === c.key} onClick={() => setFilter(c.key)}>{accountKindLabel(c.kinds[0]!)} <small>{c.count}</small></button>
          ))}
        </div>
      )}

      {error ? (
        <div className="card"><div className="empty"><b>{t("acc.loadFail")}</b><button className="btn" style={{ marginTop: 10 }} onClick={() => reload()}>{t("common.retry")}</button></div></div>
      ) : !data ? (
        <div className="card"><div className="skeleton" style={{ height: 160 }} /></div>
      ) : accounts.length === 0 ? (
        <div className="card"><div className="empty"><b>{t("acc.empty")}</b>{t("acc.emptyHint")}</div></div>
      ) : shown.length === 0 ? (
        <div className="card"><div className="empty"><b>{t("acc.noMatch")}</b>{t("acc.noMatchHint")}</div></div>
      ) : (
        <div className="card">
          {shown.map((a) => (
            <div className="row" key={a.id}>
              <AccountLogo account={a} size={40} />
              <div className="t">
                <Link href={`/accounts/${a.id}`} className="rowlink"><b className="nm">{a.name}<Icon name="chevronRight" size={15} style={{ color: "var(--muted)" }} /></b></Link>
                <small>{accountKindLabel(a.kind)}{a.includeInNetWorth ? "" : ` · ${t("acc.notCounted")}`}</small>
              </div>
              <div className="a num">{balanceText(a)}</div>
              <button className="iconbtn" onClick={() => setModal(a)} aria-label={t("acc.editAria", { name: a.name })} title={t("common.edit")}><Icon name="edit" size={16} /></button>
              {confirm === a.id ? (
                <span style={{ display: "flex", gap: 6 }}>
                  <button className="btn sm danger" onClick={() => archive(a.id)}>{t("acc.archiveConfirm")}</button>
                  <button className="btn sm" onClick={() => setConfirm(null)}>{t("common.cancel")}</button>
                </span>
              ) : (
                <button className="btn sm" onClick={() => setConfirm(a.id)} aria-label={t("acc.archiveAria", { name: a.name })}>{t("acc.archive")}</button>
              )}
            </div>
          ))}
        </div>
      )}
      {data && shown.length > 0 && shown.length !== accounts.length && <p className="hint" style={{ marginTop: 10 }}>{t("acc.shown", { n: shown.length, total: accounts.length })}</p>}

      {modal && <AccountModal account={modal === "add" ? undefined : modal} onClose={() => setModal(null)} />}
    </Shell>
  );
}
