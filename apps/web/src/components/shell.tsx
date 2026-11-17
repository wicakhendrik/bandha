"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import useSWR, { mutate } from "swr";
import { dateLong, greeting } from "@bandha/api-client";
import { api, fetcher } from "@/lib/api";
import type { DictKey } from "@/lib/dict";
import { useI18n } from "@/lib/i18n";
import type { Me } from "@/lib/types";
import { Icon, Logo } from "./icons";
import { LangSwitch } from "./lang-switch";
import { ProfileMenu } from "./profile-menu";
import { TransactionModal } from "./transaction-modal";

const NAV = [
  { href: "/dashboard", label: "nav.home", icon: "home" },
  { href: "/accounts", label: "nav.accounts", icon: "wallet" },
  { href: "/transactions", label: "nav.transactions", icon: "swap" },
  { href: "/portfolio", label: "nav.portfolio", icon: "chart" },
  { href: "/debts", label: "nav.debts", icon: "debt" },
] as const satisfies ReadonlyArray<{ href: string; label: DictKey; icon: string }>;

export function Shell({ title, children }: { title?: string; children: React.ReactNode }) {
  const { t, lang } = useI18n();
  const path = usePathname();
  const router = useRouter();
  const { data: me } = useSWR<Me>("/me", fetcher);
  const [txOpen, setTxOpen] = useState(false);
  // On an account page ("/accounts/<id>") the new transaction starts on that account.
  const openAccountId = /^\/accounts\/([^/]+)\/?$/.exec(path)?.[1];
  // Date text is computed on the client only, so the server render never disagrees with the browser.
  const [today, setToday] = useState("");
  useEffect(() => { setToday(dateLong(new Date())); }, [lang]);
  const first = me?.user.name.split(" ")[0];

  function toggleTheme() {
    const el = document.documentElement;
    const next = el.getAttribute("data-theme") === "dark" ? "light" : "dark";
    el.setAttribute("data-theme", next);
    try { localStorage.setItem("bandha-theme", next); } catch { /* storage may be unavailable */ }
  }

  async function logout() {
    await api("/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
    await mutate(() => true, undefined, { revalidate: false });
    router.replace("/login");
  }

  return (
    <div className="app">
      <aside className="side">
        <div className="brand"><Logo /><b>Bandha</b></div>
        <nav aria-label={t("nav.main")}>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={path.startsWith(n.href) ? "on" : ""} aria-current={path.startsWith(n.href) ? "page" : undefined}>
              <Icon name={n.icon} />{t(n.label)}
            </Link>
          ))}
        </nav>
        <div className="foot"><b>{t("shell.motto")}</b>{t("shell.mottoSub")}</div>
      </aside>

      <main>
        <header className="top">
          <div className="hello">
            <small>{today || " "}</small>
            <h1>{title ?? (first ? `${greeting()}, ${first}` : "Bandha")}</h1>
          </div>
          <div className="actions">
            <LangSwitch />
            <button className="btn" onClick={toggleTheme} aria-label={t("shell.theme")}><Icon name="moon" size={18} /></button>
            <button className="btn pri" onClick={() => setTxOpen(true)} aria-label={t("shell.addTx")}><Icon name="plus" size={16} /><span className="lbl">{t("shell.addTx")}</span></button>
            <button className="btn" onClick={logout} aria-label={t("shell.logout")}><Icon name="out" size={18} /></button>
            <ProfileMenu onLogout={logout} />
          </div>
        </header>
        {children}
      </main>

      <nav className="tabbar" aria-label={t("nav.bottom")}>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={path.startsWith(n.href) ? "on" : ""}>
            <Icon name={n.icon} size={21} />{t(n.label)}
          </Link>
        ))}
      </nav>
      <button className="fab" onClick={() => setTxOpen(true)} aria-label={t("shell.addTx")}><Icon name="plus" size={26} /></button>

      {txOpen && <TransactionModal initialAccountId={openAccountId} onClose={() => setTxOpen(false)} />}
    </div>
  );
}
