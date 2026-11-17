import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Platform } from "react-native";

/**
 * "Hide amounts" switch for the home screen (the eye button). Remembered between launches. While it is on, every money
 * value on the home screen is replaced by dots instead of being drawn (React Native cannot blur text), so nothing can be
 * read, copied or picked up by a screenshot.
 */
const KEY = "bandha.hideAmounts";
export const MASK = "••••••";

async function readStored(): Promise<boolean> {
  try {
    const v = Platform.OS === "web" ? globalThis.localStorage?.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    return v === "1";
  } catch {
    return false;
  }
}

async function writeStored(hidden: boolean): Promise<void> {
  try {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(KEY, hidden ? "1" : "0");
    else await SecureStore.setItemAsync(KEY, hidden ? "1" : "0");
  } catch {
    /* a failed write only means the choice is not remembered */
  }
}

interface Ctx { hidden: boolean; toggle: () => void; /** The text itself, or dots while amounts are hidden. */ mask: (text: string) => string }
const PrivacyContext = createContext<Ctx | null>(null);

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => { void readStored().then(setHidden); }, []);
  const toggle = useCallback(() => setHidden((h) => { void writeStored(!h); return !h; }), []);
  const value = useMemo<Ctx>(() => ({ hidden, toggle, mask: (text) => (hidden ? MASK : text) }), [hidden, toggle]);
  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy(): Ctx {
  const v = useContext(PrivacyContext);
  if (!v) throw new Error("usePrivacy must be used inside PrivacyProvider");
  return v;
}
