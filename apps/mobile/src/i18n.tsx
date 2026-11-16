import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Platform, Pressable, View } from "react-native";
import { setLang as setSharedLang, type Lang } from "@bandha/api-client";
import { font, useTheme } from "./theme";
import { T } from "./ui";

/**
 * Language for the app. Every string is written as an Indonesian/English pair where it is used (`t("Simpan", "Save")`),
 * so a missing translation cannot exist. Numbers and dates follow the same language through the shared formatters.
 * The choice is remembered; the first time it follows the phone's language (English phones get English, everything
 * else the default, Indonesian).
 */

const KEY = "bandha.lang";

function deviceLang(): Lang {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith("en") ? "en" : "id";
  } catch {
    return "id";
  }
}

async function readStored(): Promise<Lang | null> {
  try {
    const v = Platform.OS === "web" ? globalThis.localStorage?.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    return v === "en" || v === "id" ? v : null;
  } catch {
    return null;
  }
}

async function writeStored(lang: Lang): Promise<void> {
  try {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(KEY, lang);
    else await SecureStore.setItemAsync(KEY, lang);
  } catch {
    /* a failed write only means the choice is not remembered */
  }
}

interface Ctx { lang: Lang; setLang: (lang: Lang) => void }
const LangContext = createContext<Ctx | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setL] = useState<Lang>(deviceLang);
  // The shared formatters read a module-level setting; setting it during render makes every screen below use it at once.
  setSharedLang(lang);

  useEffect(() => {
    void readStored().then((stored) => { if (stored) setL(stored); });
  }, []);

  const setLang = useCallback((next: Lang) => { setL(next); void writeStored(next); }, []);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): Ctx {
  const v = useContext(LangContext);
  if (!v) throw new Error("useLang must be used inside LangProvider");
  return v;
}

/** `t(indonesian, english)`. Using the hook also re-renders the screen when the language changes. */
export function useT(): (id: string, en: string) => string {
  const { lang } = useLang();
  return useCallback((id: string, en: string) => (lang === "en" ? en : id), [lang]);
}

/** Small ID | EN switch, for screens shown before sign-in. */
export function LangToggle() {
  const c = useTheme();
  const { lang, setLang } = useLang();
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: "row", backgroundColor: c.mori, borderRadius: 99, padding: 3, gap: 2 }}>
      {(["id", "en"] as const).map((l) => (
        <Pressable key={l} onPress={() => setLang(l)} accessibilityRole="radio" accessibilityState={{ selected: lang === l }}
          accessibilityLabel={l === "id" ? "Bahasa Indonesia" : "English"} hitSlop={6}
          style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 99, backgroundColor: lang === l ? c.card : "transparent" }}>
          <T v="label" color={lang === l ? c.ink : c.muted} style={{ fontFamily: font.sansSemi }}>{l.toUpperCase()}</T>
        </Pressable>
      ))}
    </View>
  );
}
