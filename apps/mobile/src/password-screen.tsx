import { Link, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError } from "@bandha/api-client";
import { client } from "./api";
import { LangToggle, useT } from "./i18n";
import { useTheme } from "./theme";
import { Banner, Btn, Field, Logo, T } from "./ui";

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? (e.issues?.[0] ? `${e.issues[0].path}: ${e.issues[0].message}` : e.message) : fallback);

/** Accepts the whole emailed link or just the code: whatever was pasted, the token is what follows "token=". */
export const extractToken = (raw: string): string => {
  const v = raw.trim();
  const m = v.match(/[?&]token=([^&\s#]+)/);
  return decodeURIComponent(m ? m[1]! : v);
};

function Frame({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 28, paddingBottom: 32, paddingHorizontal: 24, gap: 14 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Logo size={34} />
            <T v="title" color={c.sogan}>Bandha</T>
          </View>
          <LangToggle />
        </View>
        <T v="title" accessibilityRole="header">{title}</T>
        <T v="small" muted>{sub}</T>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Step 1: ask for a link. The answer is the same whether or not the email has an account. */
export function ForgotScreen() {
  const c = useTheme();
  const t = useT();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError(t("Format email tidak valid", "Invalid email format"));
    setBusy(true);
    try {
      await client.forgotPassword(email.trim());
      setSent(true);
    } catch (e) {
      setError(message(e, t("Terjadi kesalahan", "Something went wrong")));
    }
    setBusy(false);
  }

  return (
    <Frame title={t("Lupa kata sandi", "Forgot your password")} sub={t("Masukkan email akun Anda. Kami kirim tautan untuk membuat kata sandi baru.", "Enter your account email. We will send a link to create a new password.")}>
      {error ? <Banner tone="err">{error}</Banner> : null}
      {sent ? (
        <>
          <Banner tone="warn">{t("Jika email itu terdaftar, tautan atur ulang sudah dikirim. Cek kotak masuk (dan folder spam). Tautan berlaku 30 menit.", "If that email has an account, a reset link has been sent. Check your inbox (and spam folder). The link is valid for 30 minutes.")}</Banner>
          <T v="small" muted>{t("Buka tautan di email untuk mengatur kata sandi di browser, atau salin tautannya lalu tempel di layar berikut.", "Open the link in the email to set your password in the browser, or copy the link and paste it on the next screen.")}</T>
          <Btn label={t("Saya sudah punya tautan atau kode", "I already have a link or code")} onPress={() => router.push("/reset-password")} />
        </>
      ) : (
        <>
          <Field label={t("Email", "Email")} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" returnKeyType="go" onSubmitEditing={submit} />
          <Btn label={t("Kirim tautan", "Send link")} onPress={submit} busy={busy} />
          <Btn label={t("Saya sudah punya tautan atau kode", "I already have a link or code")} kind="ghost" onPress={() => router.push("/reset-password")} />
        </>
      )}
      <View style={{ flexDirection: "row", justifyContent: "center", marginTop: 4 }}>
        <Link href="/login" replace><T v="label" color={c.sogan}>{t("Kembali ke halaman masuk", "Back to sign in")}</T></Link>
      </View>
    </Frame>
  );
}

/** Step 2: paste the emailed link (or its code) and choose a new password. */
export function ResetScreen() {
  const c = useTheme();
  const t = useT();
  const params = useLocalSearchParams<{ token?: string }>();
  const [code, setCode] = useState(params.token ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    const token = extractToken(code);
    if (token.length < 20) return setError(t("Tempel tautan atau kode dari email", "Paste the link or code from the email"));
    if (password.length < 10) return setError(t("Kata sandi minimal 10 karakter", "Password must be at least 10 characters"));
    if (password !== confirm) return setError(t("Kedua kata sandi tidak sama", "The two passwords do not match"));
    setBusy(true);
    try {
      await client.resetPassword(token, password);
      setDone(true);
    } catch (e) {
      setError(message(e, t("Terjadi kesalahan", "Something went wrong")));
    }
    setBusy(false);
  }

  return (
    <Frame title={t("Buat kata sandi baru", "Create a new password")} sub={t("Pilih kata sandi baru untuk akun Anda.", "Choose a new password for your account.")}>
      {done ? (
        <>
          <Banner tone="warn">{t("Kata sandi sudah diganti. Masuk dengan kata sandi baru. Semua perangkat lain otomatis keluar.", "Your password has been changed. Sign in with the new password. All other devices are signed out.")}</Banner>
          <Btn label={t("Masuk", "Sign in")} onPress={() => router.replace("/login")} />
        </>
      ) : (
        <>
          {error ? <Banner tone="err">{error}</Banner> : null}
          <Field label={t("Tautan atau kode dari email", "Link or code from the email")} value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} multiline />
          <Field label={t("Kata sandi baru", "New password")} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" hint={t("Minimal 10 karakter.", "At least 10 characters.")} />
          <Field label={t("Ulangi kata sandi baru", "Repeat new password")} value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" textContentType="newPassword" returnKeyType="go" onSubmitEditing={submit} />
          <Btn label={t("Simpan kata sandi", "Save password")} onPress={submit} busy={busy} />
          <View style={{ flexDirection: "row", justifyContent: "center", marginTop: 4 }}>
            <Link href="/forgot-password" replace><T v="label" color={c.sogan}>{t("Minta tautan baru", "Request a new link")}</T></Link>
          </View>
        </>
      )}
    </Frame>
  );
}
