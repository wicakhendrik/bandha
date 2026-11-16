"use client";
import { useI18n } from "@/lib/i18n";
import { Icon } from "./icons";

/** Indonesian / English toggle. The choice is remembered (cookie + localStorage). */
export function LangSwitch({ dark = false }: { dark?: boolean }) {
  const { lang, setLang, t } = useI18n();
  return (
    <div className={`lang${dark ? " dark" : ""}`} role="group" aria-label={t("lang.label")}>
      <Icon name="globe" size={15} />
      {(["id", "en"] as const).map((l) => (
        <button key={l} type="button" aria-pressed={lang === l} className={lang === l ? "on" : ""} onClick={() => setLang(l)} title={t(l === "id" ? "lang.id" : "lang.en")}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
