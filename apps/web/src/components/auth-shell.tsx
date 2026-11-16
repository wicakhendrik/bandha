"use client";
import { useI18n } from "@/lib/i18n";
import { Logo } from "./icons";
import { LangSwitch } from "./lang-switch";

/** The two-column frame shared by sign in, sign up, and the password reset pages. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="auth">
      <div className="art">
        <div className="brand" style={{ padding: 0 }}><Logo size={38} /><b>Bandha</b></div>
        <div>
          <h2>{t("auth.artTitle")}</h2>
          <p>{t("auth.artBody")}</p>
        </div>
        <small style={{ color: "#CDB99B" }}>{t("shell.motto")}</small>
      </div>
      <div className="form">
        <div className="authtop"><LangSwitch /></div>
        {children}
      </div>
    </div>
  );
}
