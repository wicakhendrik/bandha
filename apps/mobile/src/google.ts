import { Platform } from "react-native";

/**
 * Google sign-in on the phone. Google's own sheet picks the account and hands back an ID token for the project's
 * **Web** client id; the API verifies that token (the app never trusts it). Needs the native module, so it only exists in
 * a real build (the APK or a dev build), not in Expo Go or the browser preview: there the button is simply hidden.
 */
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";

type Lib = typeof import("@react-native-google-signin/google-signin");
let lib: Lib | null | undefined;

function load(): Lib | null {
  if (lib !== undefined) return lib;
  try {
    if (Platform.OS === "web" || !WEB_CLIENT_ID) throw new Error("Google sign-in is off");
    // Loaded on demand: without the native module (Expo Go) the import itself throws, and that must not break the app.
    const m = require("@react-native-google-signin/google-signin") as Lib;
    m.GoogleSignin.configure({ webClientId: WEB_CLIENT_ID });
    lib = m;
  } catch {
    lib = null;
  }
  return lib;
}

/** Whether this build can offer "Continue with Google" at all. */
export const googleAvailable = (): boolean => load() !== null;

/** Opens Google's account sheet. Resolves with the ID token, or null when the person closed the sheet without choosing. */
export async function googleIdToken(): Promise<string | null> {
  const g = load();
  if (!g) throw new Error("Google sign-in is not available in this build");
  await g.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const r = await g.GoogleSignin.signIn();
  if (r.type !== "success") return null;
  if (!r.data.idToken) throw new Error("Google returned no ID token");
  return r.data.idToken;
}

/** Forgets the Google account on this phone, so the next sign-in shows the account chooser again. Never throws. */
export async function googleSignOut(): Promise<void> {
  try { await load()?.GoogleSignin.signOut(); } catch { /* nothing to forget */ }
}
