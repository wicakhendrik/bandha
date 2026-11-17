"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { DONATE_WALLETS, QRIS, qrMatrix, qrPath, type CryptoWallet } from "@bandha/api-client";
import { useI18n } from "@/lib/i18n";
import { Icon, Logo } from "./icons";
import { LangSwitch } from "./lang-switch";

/** The wallet address as a QR code, drawn locally (nothing is sent anywhere). */
function Qr({ text, label }: { text: string; label: string }) {
  const { d, n } = useMemo(() => { const m = qrMatrix(text); return { d: qrPath(m), n: m.length }; }, [text]);
  const quiet = 3;
  return (
    <svg className="dn-qr" viewBox={`${-quiet} ${-quiet} ${n + quiet * 2} ${n + quiet * 2}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x={-quiet} y={-quiet} width={n + quiet * 2} height={n + quiet * 2} fill="#fff" />
      <path d={d} fill="#1b110a" />
    </svg>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API unavailable (older browser, insecure context): fall back to selecting a hidden field.
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      try { document.execCommand("copy"); } catch { /* nothing more to try */ }
      el.remove();
    }
    setDone(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 2000);
  }
  return (
    <button type="button" className="btn dn-copy" onClick={copy} aria-label={label}>
      <Icon name={done ? "check" : "copy"} size={16} />
      <span aria-live="polite">{done ? t("donate.copied") : t("donate.copy")}</span>
    </button>
  );
}

function WalletCard({ w }: { w: CryptoWallet }) {
  const { t } = useI18n();
  return (
    <article className="card dn-card">
      <h3>{w.name}</h3>
      <div className="dn-nets" aria-label={t("donate.networks")}>
        {w.networks.map((n) => <span key={n} className="dn-chip">{n}</span>)}
        {w.kind === "evm" && <span className="dn-chip more">{t("donate.evmMore")}</span>}
      </div>
      <Qr text={w.address} label={t("donate.qrFor", { name: w.name })} />
      <div className="dn-addr">
        <small>{t("donate.address")}</small>
        <code>{w.address}</code>
      </div>
      <CopyButton text={w.address} label={t("donate.copyLabel", { name: w.name })} />
    </article>
  );
}

/** Public page: how to chip in toward Bandha's running costs. */
export function DonatePage() {
  const { t } = useI18n();
  return (
    <div className="dn">
      <header className="dn-top">
        <Link href="/" className="lp-brand"><Logo size={30} /><b>Bandha</b></Link>
        <LangSwitch />
      </header>
      <main className="dn-main">
        <Link href="/" className="dn-back"><Icon name="arrowLeft" size={16} />{t("donate.back")}</Link>
        <h1 className="serif">{t("donate.title")}</h1>
        <p className="dn-lead">{t("donate.lead")}</p>

        <section aria-labelledby="dn-qris">
          <article className="card dn-card dn-qris">
            <h2 id="dn-qris">{t("donate.qrisTitle")}</h2>
            <p className="dn-sub">{t("donate.qrisSub")}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/donate/qris.webp" alt={t("donate.qrisAlt", { merchant: QRIS.merchant })} className="dn-qrisimg" width={420} />
            <dl className="dn-meta">
              <div><dt>{t("donate.recipient")}</dt><dd>{QRIS.merchant}</dd></div>
              <div><dt>NMID</dt><dd>{QRIS.nmid}</dd></div>
            </dl>
            <a className="btn" href="/donate/qris.webp" download="bandha-qris.webp"><Icon name="download" size={16} />{t("donate.save")}</a>
          </article>
        </section>

        <section aria-labelledby="dn-crypto">
          <h2 id="dn-crypto">{t("donate.cryptoTitle")}</h2>
          <p className="dn-sub">{t("donate.cryptoSub")}</p>
          <div className="dn-grid">{DONATE_WALLETS.map((w) => <WalletCard key={w.kind} w={w} />)}</div>
          <div className="warn" role="note">{t("donate.warn")}</div>
        </section>

        <p className="dn-note">{t("donate.note")}</p>
        <p className="dn-thanks serif">{t("donate.thanks")}</p>
      </main>
    </div>
  );
}
