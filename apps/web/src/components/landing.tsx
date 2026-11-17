"use client";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import type { DictKey } from "@/lib/dict";
import { Icon, Logo } from "./icons";
import { LangSwitch } from "./lang-switch";

/** Screenshot with an optional dark-theme twin; CSS shows the one that matches the theme. */
function Shot({ name, dark, alt, w = 1400, h = 875, eager = false }: { name: string; dark?: string; alt: string; w?: number; h?: number; eager?: boolean }) {
  const common = { width: w, height: h, alt, decoding: "async" as const, ...(eager ? { fetchPriority: "high" as const } : { loading: "lazy" as const }) };
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={dark ? "lp-lt" : undefined} src={`/landing/${name}.webp`} {...common} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {dark && <img className="lp-dk" src={`/landing/${dark}.webp`} {...common} alt="" aria-hidden="true" />}
    </>
  );
}

function Browser({ children }: { children: React.ReactNode }) {
  return (
    <div className="lp-browser">
      <div className="lp-bar" aria-hidden="true"><i /><i /><i /></div>
      {children}
    </div>
  );
}

function toggleTheme() {
  const el = document.documentElement;
  const next = el.getAttribute("data-theme") === "dark" ? "light" : "dark";
  el.setAttribute("data-theme", next);
  try { localStorage.setItem("bandha-theme", next); } catch { /* storage may be unavailable */ }
}

const FEATURES: Array<{ icon: Parameters<typeof Icon>[0]["name"]; t: DictKey; d: DictKey }> = [
  { icon: "wallet", t: "land.f1t", d: "land.f1d" },
  { icon: "chart", t: "land.f2t", d: "land.f2d" },
  { icon: "swap", t: "land.f3t", d: "land.f3d" },
  { icon: "debt", t: "land.f4t", d: "land.f4d" },
  { icon: "up", t: "land.f5t", d: "land.f5d" },
  { icon: "check", t: "land.f6t", d: "land.f6d" },
];

const PRINCIPLES: Array<{ t: DictKey; d: DictKey }> = [
  { t: "land.p1t", d: "land.p1d" }, { t: "land.p2t", d: "land.p2d" }, { t: "land.p3t", d: "land.p3d" }, { t: "land.p4t", d: "land.p4d" },
];

const FAQ: Array<{ q: DictKey; a: DictKey }> = [
  { q: "land.q1", a: "land.a1" }, { q: "land.q2", a: "land.a2" }, { q: "land.q3", a: "land.a3" }, { q: "land.q4", a: "land.a4" }, { q: "land.q5", a: "land.a5" },
];

export function Landing() {
  const { t, lang } = useI18n();
  const heroLight = lang === "en" ? "web-dashboard-en" : "web-dashboard";

  const showcase = [
    { id: "s1", img: "web-portfolio", dark: "web-portfolio-dark", rev: false },
    { id: "s2", img: "web-debts", dark: undefined, rev: true },
    { id: "s3", img: "web-import", dark: undefined, rev: false },
  ] as const;

  return (
    <div className="lp">
      <a className="lp-skip" href="#fitur">{t("land.navFeatures")}</a>
      <header className="lp-nav">
        <div className="lp-wrap lp-navin">
          <Link href="/" className="lp-brand" aria-label="Bandha"><Logo size={32} /><b>Bandha</b></Link>
          <nav className="lp-links" aria-label={t("land.navLabel")}>
            <a href="#fitur">{t("land.navFeatures")}</a>
            <a href="#prinsip">{t("land.navPrinciples")}</a>
            <a href="#mobile">{t("land.navMobile")}</a>
            <a href="#faq">{t("land.navFaq")}</a>
          </nav>
          <div className="lp-navact">
            <LangSwitch />
            <button type="button" className="btn lp-theme" onClick={toggleTheme} aria-label={t("shell.theme")}><Icon name="moon" size={18} /></button>
            <Link href="/login" className="btn lp-login">{t("land.login")}</Link>
            <Link href="/register" className="btn pri">{t("land.register")}</Link>
          </div>
        </div>
      </header>

      <main className="lp-main">
        {/* hero */}
        <section className="lp-hero">
          <div className="lp-wrap lp-herogrid">
            <div className="lp-herotext">
              <span className="lp-eyebrow">{t("land.eyebrow")}</span>
              <h1>{t("land.heroTitle")}</h1>
              <p className="lp-lead">{t("land.heroBody")}</p>
              <div className="lp-cta">
                <Link href="/register" className="btn pri lp-big">{t("land.ctaStart")} <Icon name="chevronRight" size={18} /></Link>
                <Link href="/login" className="lp-textlink">{t("land.ctaLogin")}</Link>
              </div>
              <p className="lp-note">{t("land.heroNote")}</p>
            </div>
            <div className="lp-device">
              <Browser><Shot name={heroLight} dark="web-dashboard-dark" alt={t("land.heroAlt")} eager /></Browser>
              <div className="lp-phone" aria-hidden="true"><Shot name="mobile-home" alt="" w={400} h={866} eager /></div>
            </div>
          </div>
        </section>

        <section className="lp-facts" aria-label="Bandha">
          <div className="lp-wrap">
            {(["land.facts1", "land.facts2", "land.facts3", "land.facts4"] as const).map((k) => <span key={k}><Icon name="check" size={16} />{t(k)}</span>)}
          </div>
        </section>

        {/* features */}
        <section id="fitur" className="lp-sec">
          <div className="lp-wrap">
            <div className="lp-head">
              <h2>{t("land.featTitle")}</h2>
              <p>{t("land.featSub")}</p>
            </div>
            <div className="lp-feats">
              {FEATURES.map((f) => (
                <article key={f.t} className="lp-feat">
                  <span className="lp-ico"><Icon name={f.icon} size={22} /></span>
                  <h3>{t(f.t)}</h3>
                  <p>{t(f.d)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* showcase */}
        <section className="lp-sec lp-showcase">
          <div className="lp-wrap">
            {showcase.map((s) => (
              <div key={s.id} className={`lp-row${s.rev ? " rev" : ""}`}>
                <div className="lp-rowtext">
                  <h2>{t(`land.${s.id}t` as DictKey)}</h2>
                  <p>{t(`land.${s.id}d` as DictKey)}</p>
                  <ul>
                    {(["a", "b", "c"] as const).map((x) => <li key={x}><span><Icon name="check" size={15} /></span>{t(`land.${s.id}${x}` as DictKey)}</li>)}
                  </ul>
                </div>
                <div className="lp-rowimg"><Browser><Shot name={s.img} dark={s.dark} alt={t(`land.${s.id}alt` as DictKey)} /></Browser></div>
              </div>
            ))}
          </div>
        </section>

        {/* principles */}
        <section id="prinsip" className="lp-principles">
          <div className="lp-wrap">
            <div className="lp-head light">
              <h2>{t("land.prTitle")}</h2>
              <p>{t("land.prSub")}</p>
            </div>
            <div className="lp-pgrid">
              {PRINCIPLES.map((p, i) => (
                <article key={p.t} className="lp-pcard">
                  <span className="lp-num serif" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                  <h3>{t(p.t)}</h3>
                  <p>{t(p.d)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* mobile */}
        <section id="mobile" className="lp-sec">
          <div className="lp-wrap lp-mob">
            <div className="lp-mobtext">
              <h2>{t("land.mobTitle")}</h2>
              <p>{t("land.mobBody")}</p>
              <p className="lp-soon"><Icon name="globe" size={17} />{t("land.mobSoon")}</p>
            </div>
            <div className="lp-phones">
              <div className="lp-ph"><Shot name="mobile-home" alt={t("land.mobAlt1")} w={400} h={866} /></div>
              <div className="lp-ph"><Shot name="mobile-portfolio" alt={t("land.mobAlt2")} w={400} h={866} /></div>
              <div className="lp-ph"><Shot name="mobile-debts" alt={t("land.mobAlt3")} w={400} h={866} /></div>
            </div>
          </div>
        </section>

        {/* faq */}
        <section id="faq" className="lp-sec lp-faqsec">
          <div className="lp-wrap lp-narrow">
            <div className="lp-head"><h2>{t("land.faqTitle")}</h2></div>
            <div className="lp-faq">
              {FAQ.map((f) => (
                <details key={f.q}>
                  <summary>{t(f.q)}<Icon name="chevronDown" size={18} /></summary>
                  <p>{t(f.a)}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* final call to action */}
        <section className="lp-sec lp-finalsec">
          <div className="lp-wrap">
            <div className="lp-final">
              <h2>{t("land.finalTitle")}</h2>
              <p>{t("land.finalBody")}</p>
              <div className="lp-cta center">
                <Link href="/register" className="btn lp-gold lp-big">{t("land.ctaStart")} <Icon name="chevronRight" size={18} /></Link>
                <Link href="/login" className="lp-textlink light">{t("land.ctaLogin")}</Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap lp-footin">
          <div className="lp-brand"><Logo size={28} /><b>Bandha</b></div>
          <span className="serif lp-motto">{t("land.footer")}</span>
          <Link href="/donate" className="lp-textlink">{t("donate.link")}</Link>
          <small suppressHydrationWarning>{t("land.copy", { year: new Date().getFullYear() })}</small>
        </div>
      </footer>
    </div>
  );
}
