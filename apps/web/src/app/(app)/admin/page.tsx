"use client";
import useSWR from "swr";
import { AdminFrame } from "@/components/admin-frame";
import { fetcher } from "@/lib/api";
import type { DictKey } from "@/lib/dict";
import { useI18n } from "@/lib/i18n";
import type { AdminStats } from "@/lib/types";

const fmtNum = (n: number) => n.toLocaleString("id-ID");

export default function AdminStatsPage() {
  const { t, lang } = useI18n();
  const { data: s, error, mutate: reload } = useSWR<AdminStats>("/admin/stats", fetcher, { refreshInterval: 60_000 });

  const cards: Array<[DictKey, number, string]> = s ? [
    ["admin.s.total", s.users.total, ""], ["admin.s.verified", s.users.verified, ""], ["admin.s.unverified", s.users.unverified, ""],
    ["admin.s.disabled", s.users.disabled, s.users.disabled > 0 ? "neg" : ""], ["admin.s.admins", s.users.admins, ""],
    ["admin.s.new7", s.newUsers.last7d, ""], ["admin.s.new30", s.newUsers.last30d, ""],
    ["admin.s.active24", s.active.last24h, ""], ["admin.s.active7", s.active.last7d, ""], ["admin.s.active30", s.active.last30d, ""],
    ["admin.s.accounts", s.data.accounts, ""], ["admin.s.tx", s.data.transactions, ""], ["admin.s.quotes", s.market.quotes, ""],
  ] : [];
  const max = Math.max(1, ...(s?.signups.map((d) => d.count) ?? [1]));
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(lang === "en" ? "en-GB" : "id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }) : "—");

  return (
    <AdminFrame>
      {error ? (
        <div className="card"><div className="empty"><b>{t("admin.loadFail")}</b><button className="btn" style={{ marginTop: 10 }} onClick={() => reload()}>{t("common.retry")}</button></div></div>
      ) : !s ? (
        <div className="card"><div className="skeleton" style={{ height: 220 }} /></div>
      ) : (
        <>
          <div className="admstats">
            {cards.map(([label, value, tone]) => (
              <article className="card" key={label}><div className="k">{t(label)}</div><div className={`v num ${tone}`}>{fmtNum(value)}</div></article>
            ))}
            <article className="card"><div className="k">{t("admin.s.lastQuote")}</div><div className="v sm">{when(s.market.lastQuoteAt)}</div></article>
          </div>
          <article className="card" style={{ marginTop: 14 }}>
            <h3>{t("admin.signups")}</h3>
            <div className="admbars" role="img" aria-label={t("admin.signups")}>
              {s.signups.map((d) => <i key={d.day} style={{ height: `${Math.max(2, (d.count / max) * 100)}%` }} title={t("admin.signupsBar", { day: d.day, n: d.count })} className={d.count === 0 ? "z" : ""} />)}
            </div>
            <div className="admaxis"><small>{s.signups[0]?.day}</small><small>{t("admin.signupsBar", { day: "max", n: max })}</small><small>{s.signups.at(-1)?.day}</small></div>
          </article>
          <p className="hint" style={{ marginTop: 12 }}>{t("admin.statsNote")}</p>
        </>
      )}
    </AdminFrame>
  );
}
