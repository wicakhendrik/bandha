// Per-weight imports: the package index would bundle every weight (~40 font files).
import { Fraunces_600SemiBold } from "@expo-google-fonts/fraunces/600SemiBold";
import { IBMPlexMono_400Regular } from "@expo-google-fonts/ibm-plex-mono/400Regular";
import { IBMPlexMono_500Medium } from "@expo-google-fonts/ibm-plex-mono/500Medium";
import { PlusJakartaSans_400Regular } from "@expo-google-fonts/plus-jakarta-sans/400Regular";
import { PlusJakartaSans_500Medium } from "@expo-google-fonts/plus-jakarta-sans/500Medium";
import { PlusJakartaSans_600SemiBold } from "@expo-google-fonts/plus-jakarta-sans/600SemiBold";
import { PlusJakartaSans_700Bold } from "@expo-google-fonts/plus-jakarta-sans/700Bold";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SWRConfig } from "swr";
import { client } from "../src/api";
import { AuthProvider, useAuth } from "../src/auth";
import { LangProvider } from "../src/i18n";
import { PrivacyProvider } from "../src/privacy";

void SplashScreen.preventAutoHideAsync();

function Gate() {
  const { status } = useAuth();
  const [fonts] = useFonts({
    Fraunces_600SemiBold, PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold, IBMPlexMono_400Regular, IBMPlexMono_500Medium,
  });
  const ready = fonts && status !== "loading";

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={status === "authed"}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={status === "anon"}>
        <Stack.Screen name="login" options={{ animation: "fade" }} />
        <Stack.Screen name="register" options={{ animation: "fade" }} />
        <Stack.Screen name="forgot-password" />
        <Stack.Screen name="reset-password" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SWRConfig value={{ fetcher: (key: string) => client.request(key), shouldRetryOnError: false, dedupingInterval: 2000 }}>
        <LangProvider>
          <PrivacyProvider>
            <AuthProvider>
              <StatusBar style="auto" />
              <Gate />
            </AuthProvider>
          </PrivacyProvider>
        </LangProvider>
      </SWRConfig>
    </SafeAreaProvider>
  );
}
