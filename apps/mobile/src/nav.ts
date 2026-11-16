import { router } from "expo-router";

/** Back one screen; if the screen was opened directly (no history), go to the home tab instead. */
export function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}
