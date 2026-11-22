import { Link, router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError } from "@bandha/api-client";
import { useAuth } from "./auth";
import { googleAvailable, googleIdToken } from "./google";
import { LangToggle, useT } from "./i18n";
import { useTheme } from "./theme";
import { BatikBackground, Banner, Btn, Field, Logo, T } from "./ui";

function message(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    const i = e.issues?.[0];
    return i ? `${i.path ? `${i.path}: ` : ""}${i.message}` : e.message;
  }
  return fallback;
}

export function AuthScreen({ mode }: { mode: "login" | "register" }) {
  const c = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { signIn, signUp, signInWithGoogle } = useAuth();
  // Decided once: it needs the native module and a configured Web client id, so it is absent in Expo Go and the browser preview.
  const [canGoogle] = useState(googleAvailable);
  const reg = mode === "register";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    if (reg && !name.trim()) return setError(t("Nama wajib diisi", "Name is required"));
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError(t("Format email tidak valid", "Invalid email format"));
    if (reg && password.length < 10) return setError(t("Kata sandi minimal 10 karakter", "Password must be at least 10 characters"));
    setBusy(true);
    try {
      if (reg) {
        // With email verification on, a 6-digit code was just emailed and nobody is signed in yet.
        const r = await signUp(name.trim(), email.trim(), password);
        if (r.verifyEmail) router.replace({ pathname: "/verify", params: { email: r.verifyEmail } });
      } else await signIn(email.trim(), password);
    } catch (e) {
      // Right password, but the address was never confirmed: the server has just sent a fresh code.
      if (e instanceof ApiError && e.code === "email_unverified") return router.replace({ pathname: "/verify", params: { email: email.trim().toLowerCase() } });
      setError(message(e, t("Terjadi kesalahan", "Something went wrong")));
      setBusy(false);
    }
  }

  // The same button signs in and signs up. Closing Google's sheet is not an error; the server's refusals (e.g. a disabled account) are shown.
  async function google() {
    setError("");
    setBusy(true);
    try {
      const idToken = await googleIdToken();
      if (idToken) await signInWithGoogle(idToken);
    } catch (e) {
      setError(message(e, t("Login Google gagal. Coba lagi.", "Google sign-in failed. Try again.")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View style={{ paddingTop: insets.top + 36, paddingBottom: 32, paddingHorizontal: 24, overflow: "hidden", borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }}>
          <BatikBackground colors={["#2A1A10", "#3A2416", "#4A2E1B"]} opacity={0.18} />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Logo size={38} />
              <T v="title" color="#F6E9CF">Bandha</T>
            </View>
            <LangToggle />
          </View>
          <T v="heading" color="#F6E9CF" style={{ marginTop: 22, fontSize: 24, lineHeight: 30 }}>{t("Harta tertata, hati tenang.", "Wealth in order, mind at ease.")}</T>
          <T v="small" color="#CDB99B" style={{ marginTop: 6 }}>Gemi, nastiti, ngati-ati.</T>
        </View>

        <View style={{ padding: 24, gap: 14 }}>
          <T v="title" accessibilityRole="header">{reg ? t("Buat akun", "Create account") : t("Selamat datang kembali", "Welcome back")}</T>
          {error ? <Banner tone="err">{error}</Banner> : null}
          {canGoogle ? (
            <>
              <Btn kind="ghost" label={t("Lanjutkan dengan Google", "Continue with Google")} onPress={google} busy={busy} />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
                <T v="small" muted>{t("atau", "or")}</T>
                <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
              </View>
            </>
          ) : null}
          {reg && <Field label={t("Nama", "Name")} value={name} onChangeText={setName} autoComplete="name" textContentType="name" returnKeyType="next" />}
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" returnKeyType="next" />
          <Field label={t("Kata sandi", "Password")} value={password} onChangeText={setPassword} secureTextEntry autoComplete={reg ? "new-password" : "current-password"} textContentType={reg ? "newPassword" : "password"} hint={reg ? t("Minimal 10 karakter.", "At least 10 characters.") : undefined} returnKeyType="go" onSubmitEditing={submit} />
          <Btn label={reg ? t("Daftar", "Sign up") : t("Masuk", "Sign in")} onPress={submit} busy={busy} />
          {!reg ? (
            <View style={{ alignItems: "center" }}>
              <Link href="/forgot-password"><T v="label" color={c.sogan}>{t("Lupa kata sandi?", "Forgot password?")}</T></Link>
            </View>
          ) : null}
          <View style={{ flexDirection: "row", justifyContent: "center", gap: 6, marginTop: 4 }}>
            <T v="small" muted>{reg ? t("Sudah punya akun?", "Already have an account?") : t("Belum punya akun?", "No account yet?")}</T>
            <Link href={reg ? "/login" : "/register"} replace>
              <T v="label" color={c.sogan}>{reg ? t("Masuk", "Sign in") : t("Daftar", "Sign up")}</T>
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
