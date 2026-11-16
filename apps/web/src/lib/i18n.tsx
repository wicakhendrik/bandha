"use client";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { setLang as setSharedLang, type Lang } from "@bandha/api-client";
import { DICT, type DictKey } from "./dict";
import { LANG_COOKIE } from "./lang";

interface Ctx {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** Translates a key; {name} placeholders are filled from `vars`. */
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ initial, children }: { initial: Lang; children: ReactNode }) {
  const [lang, setL] = useState<Lang>(initial);
  // Number/date formatters live in a shared package and read this module-level setting. Setting it during render
  // (not in an effect) makes the very first paint, including server rendering, use the right language.
  setSharedLang(lang);

  const setLang = useCallback((next: Lang) => {
    setSharedLang(next);
    setL(next);
    document.documentElement.lang = next;
    // The cookie lets the server render the next page in the same language (no flash on reload).
    document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    try { localStorage.setItem(LANG_COOKIE, next); } catch { /* storage may be unavailable */ }
  }, []);

  const value = useMemo<Ctx>(() => ({
    lang,
    setLang,
    t: (key, vars) => {
      let s: string = DICT[lang][key] ?? DICT.id[key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
      return s;
    },
  }), [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const v = useContext(I18nContext);
  if (!v) throw new Error("useI18n must be used inside I18nProvider");
  return v;
}
