"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import type { DictKey } from "@/lib/dict";
import { useI18n } from "@/lib/i18n";
import type { Me } from "@/lib/types";
import { Shell } from "./shell";

const TABS = [
  { href: "/admin", label: "admin.tabStats" },
  { href: "/admin/users", label: "admin.tabUsers" },
  { href: "/admin/audit", label: "admin.tabAudit" },
] as const satisfies ReadonlyArray<{ href: string; label: DictKey }>;

/** The admin pages' shared shell: only admins get past it (the API enforces the same), plus the three tabs. */
export function AdminFrame({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const path = usePathname();
  const { data: me } = useSWR<Me>("/me", fetcher);
  return (
    <Shell title={t("admin.title")}>
      {!me ? (
        <div className="card"><div className="skeleton" style={{ height: 160 }} /></div>
      ) : me.role !== "admin" ? (
        <div className="card"><div className="empty"><b>{t("admin.only")}</b></div></div>
      ) : (
        <>
          <nav className="admtabs" aria-label={t("admin.title")}>
            {TABS.map((tab) => (
              <Link key={tab.href} href={tab.href} className="fchip" aria-pressed={path === tab.href} aria-current={path === tab.href ? "page" : undefined}>{t(tab.label)}</Link>
            ))}
          </nav>
          {children}
        </>
      )}
    </Shell>
  );
}
