import { createClient, type TokenStorage, type Tokens } from "@bandha/api-client";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const KEY = "bandha.session";

/**
 * Tokens live in the OS keychain (iOS) / keystore (Android) via SecureStore.
 * SecureStore does not exist on web, so the browser preview falls back to sessionStorage (dev only).
 */
const storage: TokenStorage = {
  async load() {
    try {
      const raw = Platform.OS === "web" ? globalThis.sessionStorage?.getItem(KEY) : await SecureStore.getItemAsync(KEY);
      return raw ? (JSON.parse(raw) as Tokens) : null;
    } catch {
      return null;
    }
  },
  async save(t) {
    try {
      if (Platform.OS === "web") {
        if (t) globalThis.sessionStorage?.setItem(KEY, JSON.stringify(t));
        else globalThis.sessionStorage?.removeItem(KEY);
      } else if (t) await SecureStore.setItemAsync(KEY, JSON.stringify(t));
      else await SecureStore.deleteItemAsync(KEY);
    } catch {
      /* a failed write only means the user logs in again next launch */
    }
  },
};

// Android emulators reach the host machine at 10.0.2.2. Real devices: set EXPO_PUBLIC_API_URL to a LAN IP or the HTTPS domain.
const defaultUrl = Platform.select({ android: "http://10.0.2.2:4000", default: "http://localhost:4000" });
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? defaultUrl ?? "http://localhost:4000";

let onSignedOut: () => void = () => undefined;
export const setSignedOutHandler = (fn: () => void) => { onSignedOut = fn; };

export const client = createClient({ baseUrl: API_URL, storage, onSignedOut: () => onSignedOut() });
