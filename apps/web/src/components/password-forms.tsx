"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { api, errorText } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { AuthShell } from "./auth-shell";

const fullButton = { width: "100%", justifyContent: "center", padding: 13 } as const;

/** Step 1: ask for a link. The answer is the same whether or not the email has an account. */
export function ForgotPasswordForm() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError(t("auth.errEmail"));
    setBusy(true);
    try {
      await api("/auth/forgot", { method: "POST", body: { email } });
      setSent(true);
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(false);
  }

  return (
    <AuthShell>
      <form className="box" onSubmit={submit} noValidate>
        <h1>{t("auth.forgotTitle")}</h1>
        <p className="sub">{t("auth.forgotSub")}</p>
        {error && <div className="err" role="alert">{error}</div>}
        {sent ? (
          <div className="warn" role="status">{t("auth.forgotSent")}</div>
        ) : (
          <>
            <div className="field"><label htmlFor="fe">{t("auth.email")}</label>
              <input id="fe" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <button className="btn pri" style={fullButton} disabled={busy}>{busy ? t("auth.processing") : t("auth.forgotSend")}</button>
          </>
        )}
        <p className="alt"><Link href="/login">{t("auth.backToLogin")}</Link></p>
      </form>
    </AuthShell>
  );
}

/** Step 2: the page the emailed link opens. The token comes from the address and is never shown. */
export function ResetPasswordForm() {
  const { t } = useI18n();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 10) return setError(t("auth.errPassword"));
    if (password !== confirm) return setError(t("auth.errConfirm"));
    setBusy(true);
    try {
      await api("/auth/reset", { method: "POST", body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(false);
  }

  return (
    <AuthShell>
      <form className="box" onSubmit={submit} noValidate>
        <h1>{t("auth.resetTitle")}</h1>
        <p className="sub">{t("auth.resetSub")}</p>
        {done ? (
          <>
            <div className="warn" role="status">{t("auth.resetDone")}</div>
            <Link className="btn pri" style={{ ...fullButton, textDecoration: "none" }} href="/login">{t("auth.login")}</Link>
          </>
        ) : !token ? (
          <>
            <div className="err" role="alert">{t("auth.resetMissing")}</div>
            <Link className="btn pri" style={{ ...fullButton, textDecoration: "none" }} href="/forgot-password">{t("auth.requestNew")}</Link>
          </>
        ) : (
          <>
            {error && <div className="err" role="alert">{error}</div>}
            <div className="field"><label htmlFor="rp">{t("auth.newPassword")}</label>
              <input id="rp" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <span className="hint">{t("auth.passwordHint")}</span></div>
            <div className="field"><label htmlFor="rc">{t("auth.confirmPassword")}</label>
              <input id="rc" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
            <button className="btn pri" style={fullButton} disabled={busy}>{busy ? t("auth.processing") : t("auth.resetSave")}</button>
            <p className="alt"><Link href="/forgot-password">{t("auth.requestNew")}</Link></p>
          </>
        )}
      </form>
    </AuthShell>
  );
}
