"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Icon } from "@/components/icons";
import { OnboardingGuide } from "@/components/onboarding";
import { Shell } from "@/components/shell";
import { api, fetcher } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { Me } from "@/lib/types";
import type { Onboarding } from "@bandha/api-client";

const TOUR = [
  { href: "/accounts", icon: "wallet", t: "wel.t1", d: "wel.t1d" },
  { href: "/portfolio", icon: "chart", t: "wel.t2", d: "wel.t2d" },
  { href: "/debts", icon: "debt", t: "wel.t3", d: "wel.t3d" },
  { href: "/import", icon: "arrowDown", t: "wel.t4", d: "wel.t4d" },
] as const;

/** Where new people land after signing up. Anyone can leave at any time; leaving also hides the card on Home. */
export default function WelcomePage() {
  const { t } = useI18n();
  const router = useRouter();
  const { data: me } = useSWR<Me>("/me", fetcher);
  const { data: onb } = useSWR<Onboarding>("/onboarding", fetcher);
  const first = me?.user.name.split(" ")[0] ?? "";

  async function leave() {
    // Choosing "skip" means the guide is not wanted on Home either.
    if (onb && !onb.complete) await api("/onboarding/dismiss", { method: "POST", body: {} }).catch(() => undefined);
    router.push("/dashboard");
  }

  return (
    <Shell title={t("wel.title", { name: first })}>
      <p className="hint" style={{ marginBottom: 18, maxWidth: 620 }}>{t("wel.sub")}</p>
      <div style={{ maxWidth: 720, display: "grid", gap: 18 }}>
        <OnboardingGuide variant="page" />
        {onb?.complete && <div className="warn" role="status">{t("wel.allDone")}</div>}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {onb?.complete
            ? <Link className="btn pri" href="/dashboard">{t("wel.go")}</Link>
            : <button className="btn" onClick={leave}>{t("wel.skip")}</button>}
        </div>

        <section aria-labelledby="tour">
          <h3 id="tour" className="serif" style={{ fontSize: 18, marginBottom: 12 }}>{t("wel.tour")}</h3>
          <div className="tour">
            {TOUR.map((x) => (
              <Link key={x.href} href={x.href} className="card tile">
                <Icon name={x.icon} size={22} />
                <b>{t(x.t)}</b>
                <small className="muted">{t(x.d)}</small>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </Shell>
  );
}
