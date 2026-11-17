"use client";
import { useCallback, useEffect, useState } from "react";

/** localStorage key; the root layout reads the same one before first paint so hidden amounts never flash. */
export const HIDE_KEY = "bandha-hide-amounts";

/**
 * "Hide amounts" switch. The state lives in the `data-hide-money` attribute on <html> (CSS blurs every `.sens` element
 * while it is set) and is remembered in localStorage. Components only need this hook for the button and to avoid leaking
 * an amount through a tooltip while amounts are hidden.
 */
export function usePrivacy() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => { setHidden(document.documentElement.hasAttribute("data-hide-money")); }, []);
  const toggle = useCallback(() => {
    const el = document.documentElement;
    const next = !el.hasAttribute("data-hide-money");
    if (next) el.setAttribute("data-hide-money", ""); else el.removeAttribute("data-hide-money");
    try { localStorage.setItem(HIDE_KEY, next ? "1" : "0"); } catch { /* storage may be unavailable */ }
    setHidden(next);
  }, []);
  return { hidden, toggle };
}
