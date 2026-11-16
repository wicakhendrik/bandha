"use client";
import Link from "next/link";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import type { Onboarding } from "@bandha/api-client";
import { AccountModal } from "@/components/account-modal";
import { Icon } from "@/components/icons";
import { TransactionModal } from "@/components/transaction-modal";
import { api, fetcher } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/**
 * The getting-started guide. Progress comes from the server and follows the person's real data, so it ticks itself
 * as they add an account and record something. As a card it disappears once both steps are done or it is dismissed;
 * on the welcome page it stays and shows the finished state.
 */
export function OnboardingGuide({ variant }: { variant: "card" | "page" }) {
  const { t } = useI18n();
  const { data } = useSWR<Onboarding>("/onboarding", fetcher);
  const [modal, setModal] = useState<"account" | "tx" | null>(null);
  const [busy, setBusy] = useState(false);

  if (!data) return variant === "page" ? <div className="card"><div className="skeleton" style={{ height: 180 }} /></div> : null;
  if (variant === "card" && !data.show) return null;

  const steps = [
    { done: data.accounts > 0, title: t("onb.s1"), text: t("onb.s1d"), action: <button className="btn pri" onClick={() => setModal("account")}>{t("onb.s1b")}</button> },
    {
      done: data.transactions > 0, title: t("onb.s2"), text: data.accounts === 0 ? t("onb.s2w") : t("onb.s2d"),
      action: (
        <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn pri" disabled={data.accounts === 0} onClick={() => setModal("tx")}>{t("onb.s2b")}</button>
          {data.accounts > 0 && <Link className="btn" href="/import">{t("onb.s2c")}</Link>}
        </span>
      ),
    },
  ];
  const done = steps.filter((s) => s.done).length;

  async function dismiss() {
    setBusy(true);
    try { await api("/onboarding/dismiss", { method: "POST", body: {} }); await mutate("/onboarding"); } finally { setBusy(false); }
  }

  return (
    <>
      <article className="card guide" aria-labelledby="guide-title">
        <div className="head">
          <div><h3 id="guide-title">{t("onb.title")}</h3><div className="sub">{t("onb.sub")}</div></div>
          <span className="tag" role="status">{t("onb.progress", { done, total: steps.length })}</span>
        </div>
        <ol className="steps">
          {steps.map((s, i) => (
            <li key={i} className={s.done ? "done" : ""}>
              <span className="dot" aria-hidden="true">{s.done ? <Icon name="check" size={15} /> : i + 1}</span>
              <div className="body">
                <b>{s.title}{s.done && <span className="sr"> — {t("onb.ready")}</span>}</b>
                {!s.done && <p>{s.text}</p>}
                {!s.done && <div style={{ marginTop: 10 }}>{s.action}</div>}
              </div>
            </li>
          ))}
        </ol>
        {variant === "card" && <div style={{ textAlign: "right", marginTop: 6 }}><button className="linkbtn" onClick={dismiss} disabled={busy}>{t("onb.later")}</button></div>}
      </article>
      {modal === "account" && <AccountModal onClose={() => setModal(null)} />}
      {modal === "tx" && <TransactionModal onClose={() => setModal(null)} />}
    </>
  );
}
