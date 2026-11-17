"use client";
import { useEffect, useState } from "react";
import useSWR, { mutate } from "swr";
import { AdminFrame } from "@/components/admin-frame";
import { api, errorText, fetcher } from "@/lib/api";
import type { DictKey } from "@/lib/dict";
import { useI18n } from "@/lib/i18n";
import type { AdminUserRow } from "@/lib/types";

const PAGE = 25;
const FILTERS = ["all", "active", "disabled", "unverified"] as const;
type Filter = (typeof FILTERS)[number];

export default function AdminUsersPage() {
  const { t, lang } = useI18n();
  const [q, setQ] = useState("");
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState<Filter>("all");
  const [limit, setLimit] = useState(PAGE);
  // The search runs a moment after typing stops.
  useEffect(() => { const id = setTimeout(() => { setQ(typed.trim()); setLimit(PAGE); }, 300); return () => clearTimeout(id); }, [typed]);

  const key = `/admin/users?limit=${limit}&status=${status}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const { data, error, mutate: reload } = useSWR<{ users: AdminUserRow[]; total: number }>(key, fetcher, { keepPreviousData: true });
  // One inline confirmation at a time; its answer or error stays next to the row it belongs to.
  const [confirm, setConfirm] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<{ id: string; text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const date = (iso: string) => new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric" });

  async function run(id: string, path: string, body?: unknown, ok?: (r: { revoked?: number }) => string) {
    setBusy(true); setNote(null);
    try {
      const r = await api<{ revoked?: number } | undefined>(`/admin/users/${id}/${path}`, { method: "POST", body: body ?? {} });
      setConfirm(null); setReason("");
      if (ok && r) setNote({ id, text: ok(r) });
      await mutate((k) => typeof k === "string" && k.startsWith("/admin/"));
    } catch (e) {
      setNote({ id, text: errorText(e), bad: true });
    } finally { setBusy(false); }
  }

  return (
    <AdminFrame>
      <div className="card">
        <input className="input" type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t("admin.search")} aria-label={t("admin.search")} maxLength={100} />
        <div className="catchips" role="group" style={{ margin: "12px 0 4px" }}>
          {FILTERS.map((f) => (
            <button key={f} type="button" className="fchip" aria-pressed={status === f} onClick={() => { setStatus(f); setLimit(PAGE); }}>{t(`admin.f.${f}` as DictKey)}</button>
          ))}
        </div>
        {data && <p className="hint" style={{ marginBottom: 4 }}>{t("admin.total", { n: data.total })}</p>}

        {error ? (
          <div className="empty"><b>{t("admin.loadFail")}</b><button className="btn" style={{ marginTop: 10 }} onClick={() => reload()}>{t("common.retry")}</button></div>
        ) : !data ? (
          <div className="skeleton" style={{ height: 240 }} />
        ) : data.users.length === 0 ? (
          <div className="empty"><b>{t("admin.noUsers")}</b></div>
        ) : (
          <>
            {data.users.map((u) => {
              const disabled = u.disabledAt !== null;
              return (
                <div className="admrow" key={u.id}>
                  <div className="admtop">
                    <b>{u.name}</b>
                    {u.role === "admin" && <span className="tag">{t("admin.badge.admin")}</span>}
                    {disabled && <span className="tag bad">{t("admin.badge.disabled")}</span>}
                    {!u.verified && <span className="tag">{t("admin.badge.unverified")}</span>}
                  </div>
                  <span className="admwho">{u.email}</span>
                  <small className="muted">
                    {t("admin.joined", { date: date(u.createdAt) })} · {u.lastActiveAt ? t("admin.lastActive", { date: date(u.lastActiveAt) }) : t("admin.neverActive")}
                  </small>
                  <small className="muted">{t("admin.counts", { accounts: u.accounts, tx: u.transactions })}</small>
                  {note?.id === u.id && <div className={note.bad ? "err" : "warn"} role={note.bad ? "alert" : "status"} style={{ margin: "8px 0 0" }}>{note.text}</div>}
                  {confirm === u.id ? (
                    <div className="admconfirm">
                      <p>{t("admin.disableAsk")}</p>
                      <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("admin.reason")} aria-label={t("admin.reason")} maxLength={200} />
                      <span className="acts">
                        <button className="btn sm danger" disabled={busy} onClick={() => run(u.id, "disable", reason.trim() ? { reason: reason.trim() } : {})}>{t("admin.disableYes")}</button>
                        <button className="btn sm" disabled={busy} onClick={() => { setConfirm(null); setReason(""); }}>{t("common.cancel")}</button>
                      </span>
                    </div>
                  ) : (
                    <span className="acts">
                      {disabled ? (
                        <button className="btn sm" disabled={busy} onClick={() => run(u.id, "enable")}>{t("admin.enable")}</button>
                      ) : u.role === "admin" ? (
                        <small className="muted">{t("admin.adminLocked")}</small>
                      ) : (
                        <button className="btn sm" disabled={busy} onClick={() => { setConfirm(u.id); setNote(null); }}>{t("admin.disable")}</button>
                      )}
                      {u.role !== "admin" && (
                        <button className="btn sm" disabled={busy} onClick={() => run(u.id, "revoke-sessions", undefined, (r) => t("admin.revoked", { n: r.revoked ?? 0 }))}>{t("admin.revoke")}</button>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
            {data.users.length < data.total && (
              <div style={{ textAlign: "center", marginTop: 16 }}><button className="btn" onClick={() => setLimit((l) => l + PAGE)}>{t("common.loadMore")}</button></div>
            )}
          </>
        )}
      </div>
    </AdminFrame>
  );
}
