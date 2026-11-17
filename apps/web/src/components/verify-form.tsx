"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { mutate } from "swr";
import { api, errorText } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { AuthShell } from "./auth-shell";

const RESEND_SECONDS = 60;

/** Step 2 of registration: the 6-digit code that was emailed. Signs in when it is right. */
export function VerifyEmailForm() {
  const { t } = useI18n();
  const router = useRouter();
  const email = (useSearchParams().get("email") ?? "").trim().toLowerCase();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  // A code was just sent when this page opened, so the first resend is allowed after a minute.
  const [wait, setWait] = useState(RESEND_SECONDS);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!email) router.replace("/register"); }, [email, router]);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function verify(value: string) {
    setError("");
    setNote("");
    if (!/^\d{6}$/.test(value)) return setError(t("auth.errCode"));
    setBusy(true);
    try {
      await api("/auth/verify", { method: "POST", body: { email, code: value } });
      await mutate(() => true, undefined, { revalidate: false });
      router.replace("/welcome");
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  async function resend() {
    setError("");
    setNote("");
    setWait(RESEND_SECONDS);
    try {
      await api("/auth/verify/resend", { method: "POST", body: { email } });
      setNote(t("auth.codeResent"));
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <AuthShell>
      <form className="box" onSubmit={(e) => { e.preventDefault(); void verify(code); }} noValidate>
        <h1>{t("auth.verifyTitle")}</h1>
        <p className="sub">{t("auth.verifySub", { email })}</p>
        {error && <div className="err" role="alert">{error}</div>}
        {note && <div className="warn" role="status">{note}</div>}
        <div className="field"><label htmlFor="code">{t("auth.codeLabel")}</label>
          <input
            id="code" ref={input} className="input codein" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="••••••" value={code}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 6);
              setCode(v);
              if (v.length === 6 && !busy) void verify(v);
            }}
          />
          <span className="hint">{t("auth.codeHint")}</span></div>
        <button className="btn pri" style={{ width: "100%", justifyContent: "center", padding: 13 }} disabled={busy || code.length !== 6}>
          {busy ? t("auth.processing") : t("auth.verifyBtn")}
        </button>
        <p className="alt">
          <button type="button" className="linkbtn" disabled={wait > 0 || busy} onClick={resend}>
            {wait > 0 ? t("auth.resendIn", { s: wait }) : t("auth.resend")}
          </button>
        </p>
        <p className="alt">{t("auth.wrongEmail")} <Link href="/register">{t("auth.register")}</Link></p>
      </form>
    </AuthShell>
  );
}
