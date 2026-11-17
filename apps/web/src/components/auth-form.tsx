"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { mutate } from "swr";
import { ApiError, api, errorText } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { AuthShell } from "./auth-shell";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { t } = useI18n();
  const router = useRouter();
  const reg = mode === "register";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (reg && !name.trim()) return setError(t("auth.errName"));
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError(t("auth.errEmail"));
    if (reg && password.length < 10) return setError(t("auth.errPassword"));
    setBusy(true);
    try {
      const res = await api<{ verificationRequired?: boolean } | undefined>(reg ? "/auth/register" : "/auth/login", { method: "POST", body: reg ? { name: name.trim(), email, password } : { email, password } });
      // With email verification on, registering sends a code and no session exists yet: continue on the code page.
      if (reg && res?.verificationRequired) return router.replace(`/verify?email=${encodeURIComponent(email.trim().toLowerCase())}`);
      await mutate(() => true, undefined, { revalidate: false });
      router.replace(reg ? "/welcome" : "/dashboard");
    } catch (err) {
      // Right password, but the address was never confirmed: the API has just sent a fresh code.
      if (err instanceof ApiError && err.code === "email_unverified") return router.replace(`/verify?email=${encodeURIComponent(email.trim().toLowerCase())}`);
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <form className="box" onSubmit={submit} noValidate>
        <h1>{reg ? t("auth.registerTitle") : t("auth.loginTitle")}</h1>
        <p className="sub">{reg ? t("auth.registerSub") : t("auth.loginSub")}</p>
        {error && <div className="err" role="alert">{error}</div>}
        {reg && (
          <div className="field"><label htmlFor="n">{t("auth.name")}</label>
            <input id="n" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        )}
        <div className="field"><label htmlFor="e">{t("auth.email")}</label>
          <input id="e" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field"><label htmlFor="p">{t("auth.password")}</label>
          <input id="p" className="input" type="password" autoComplete={reg ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
          {reg ? <span className="hint">{t("auth.passwordHint")}</span> : <Link className="hint" href="/forgot-password" style={{ justifySelf: "end" }}>{t("auth.forgotLink")}</Link>}</div>
        <button className="btn pri" style={{ width: "100%", justifyContent: "center", padding: 13 }} disabled={busy}>
          {busy ? t("auth.processing") : reg ? t("auth.register") : t("auth.login")}
        </button>
        <p className="alt">
          {reg ? <>{t("auth.hasAccount")} <Link href="/login">{t("auth.login")}</Link></> : <>{t("auth.noAccount")} <Link href="/register">{t("auth.register")}</Link></>}
        </p>
      </form>
    </AuthShell>
  );
}
