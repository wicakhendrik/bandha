import { Link, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError } from "@bandha/api-client";
import { useAuth } from "./auth";
import { LangToggle, useT } from "./i18n";
import { font, useTheme } from "./theme";
import { Banner, Btn, Logo, T } from "./ui";

const RESEND_SECONDS = 60;

/** Step 2 of registration: the 6-digit code that was emailed. A correct code signs the person in. */
export function VerifyScreen() {
  const c = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { verifyEmail, resendCode } = useAuth();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = (params.email ?? "").trim().toLowerCase();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  // A code was just sent when this screen opened, so the first resend opens after a minute.
  const [wait, setWait] = useState(RESEND_SECONDS);

  useEffect(() => { if (!email) router.replace("/register"); }, [email]);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function verify(value: string) {
    setError("");
    setNote("");
    if (!/^\d{6}$/.test(value)) return setError(t("Masukkan 6 angka kode", "Enter the 6-digit code"));
    setBusy(true);
    try {
      await verifyEmail(email, value);
      // Signed in: the navigation guard moves on to the app by itself.
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Terjadi kesalahan", "Something went wrong"));
      setBusy(false);
    }
  }

  async function resend() {
    setError("");
    setNote("");
    setWait(RESEND_SECONDS);
    try {
      await resendCode(email);
      setNote(t("Jika alamat ini menunggu verifikasi, kode baru sudah dikirim.", "If this address is waiting for verification, a new code has been sent."));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Terjadi kesalahan", "Something went wrong"));
    }
  }

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
        <T v="title" accessibilityRole="header">{t("Masukkan kode verifikasi", "Enter the verification code")}</T>
        <T v="small" muted>{t(`Kami mengirim kode 6 angka ke ${email}. Masukkan di bawah ini untuk menyelesaikan pendaftaran.`, `We sent a 6-digit code to ${email}. Enter it below to finish signing up.`)}</T>
        {error ? <Banner tone="err">{error}</Banner> : null}
        {note ? <Banner tone="warn">{note}</Banner> : null}
        <View style={{ gap: 6 }}>
          <T v="label" muted>{t("Kode verifikasi", "Verification code")}</T>
          <TextInput
            accessibilityLabel={t("Kode verifikasi", "Verification code")}
            value={code}
            onChangeText={(raw) => {
              const v = raw.replace(/\D/g, "").slice(0, 6);
              setCode(v);
              if (v.length === 6 && !busy) void verify(v);
            }}
            keyboardType="number-pad" inputMode="numeric" maxLength={6} autoFocus autoComplete="one-time-code" textContentType="oneTimeCode"
            placeholder="••••••" placeholderTextColor={c.muted}
            style={{ backgroundColor: c.card, borderColor: c.line, borderWidth: 1, borderRadius: 12, paddingVertical: 14, color: c.ink, fontFamily: font.monoMedium, fontSize: 28, letterSpacing: 10, textAlign: "center" }}
          />
          <T v="small" muted>{t("Berlaku 10 menit. Cek juga folder spam.", "Valid for 10 minutes. Check your spam folder too.")}</T>
        </View>
        <Btn label={t("Verifikasi", "Verify")} onPress={() => verify(code)} busy={busy} disabled={code.length !== 6} />
        <View style={{ alignItems: "center", gap: 10, marginTop: 4 }}>
          <Btn label={wait > 0 ? t(`Kirim ulang kode (${wait} dtk)`, `Resend code (${wait}s)`) : t("Kirim ulang kode", "Resend code")} kind="ghost" small onPress={resend} disabled={wait > 0 || busy} />
          <View style={{ flexDirection: "row", gap: 6 }}>
            <T v="small" muted>{t("Salah email?", "Wrong email?")}</T>
            <Link href="/register" replace><T v="label" color={c.sogan}>{t("Daftar", "Sign up")}</T></Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
