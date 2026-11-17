"use client";
import { useState } from "react";
import useSWR from "swr";
import { AdminFrame } from "@/components/admin-frame";
import { fetcher } from "@/lib/api";
import type { DictKey } from "@/lib/dict";
import { useI18n } from "@/lib/i18n";
import type { AdminAuditEntry } from "@/lib/types";

const PAGE = 30;
const KNOWN = ["user.disable", "user.enable", "user.revoke_sessions", "role.grant", "role.revoke"];

export default function AdminAuditPage() {
  const { t, lang } = useI18n();
  const [limit, setLimit] = useState(PAGE);
  const { data, error, mutate: reload } = useSWR<{ entries: AdminAuditEntry[]; total: number }>(`/admin/audit?limit=${limit}`, fetcher);
  const when = (iso: string) => new Date(iso).toLocaleString(lang === "en" ? "en-GB" : "id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" });
  const action = (a: string) => (KNOWN.includes(a) ? t(`admin.act.${a}` as DictKey) : a);

  return (
    <AdminFrame>
      <div className="card">
        <p className="hint" style={{ marginBottom: 6 }}>{t("admin.auditHint")}</p>
        {error ? (
          <div className="empty"><b>{t("admin.loadFail")}</b><button className="btn" style={{ marginTop: 10 }} onClick={() => reload()}>{t("common.retry")}</button></div>
        ) : !data ? (
          <div className="skeleton" style={{ height: 200 }} />
        ) : data.entries.length === 0 ? (
          <div className="empty"><b>{t("admin.auditEmpty")}</b></div>
        ) : (
          <>
            {data.entries.map((e) => (
              <div className="admrow" key={e.id}>
                <div className="admtop"><b>{action(e.action)}</b>{e.target && <span className="admwho">{e.target}</span>}</div>
                <small className="muted">{when(e.at)} · {e.actor === "cli" ? t("admin.cli") : e.actor}</small>
                {e.detail && <small className="admdetail">{e.detail}</small>}
              </div>
            ))}
            {data.entries.length < data.total && (
              <div style={{ textAlign: "center", marginTop: 16 }}><button className="btn" onClick={() => setLimit((l) => l + PAGE)}>{t("common.loadMore")}</button></div>
            )}
          </>
        )}
      </div>
    </AdminFrame>
  );
}
