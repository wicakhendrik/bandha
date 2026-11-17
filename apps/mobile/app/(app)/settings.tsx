import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useAuth } from "../../src/auth";
import { goBack } from "../../src/nav";
import { useLang, useT } from "../../src/i18n";
import { ApiError } from "@bandha/api-client";
import { Banner, Btn, Card, Chips, Field, Screen, T } from "../../src/ui";
import type { Lang } from "@bandha/api-client";

export default function Settings() {
  const t = useT();
  const { lang, setLang } = useLang();
  const { user, signOut, updateName, changePassword } = useAuth();
  const [confirm, setConfirm] = useState(false);
  const [panel, setPanel] = useState<"name" | "password" | null>(null);
  const [name, setName] = useState(user?.name ?? "");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fail = (e: unknown) => { setError(e instanceof ApiError ? e.message : t("Terjadi kesalahan", "Something went wrong")); setBusy(false); };
  const open = (p: "name" | "password" | null) => { setPanel(p); setError(""); setNotice(""); setCurrent(""); setNext(""); setAgain(""); setName(user?.name ?? ""); };

  async function saveName() {
    setError("");
    if (!name.trim()) return setError(t("Isi nama", "Enter a name"));
    setBusy(true);
    try {
      await updateName(name.trim());
      setBusy(false);
      open(null);
      setNotice(t("Nama sudah diubah.", "Your name has been changed."));
    } catch (e) { fail(e); }
  }

  async function savePassword() {
    setError("");
    if (!current) return setError(t("Isi kata sandi saat ini", "Enter your current password"));
    if (next.length < 10) return setError(t("Kata sandi baru minimal 10 karakter", "The new password needs at least 10 characters"));
    if (next !== again) return setError(t("Kata sandi baru dan ulangannya tidak sama", "The new password and its repeat do not match"));
    setBusy(true);
    try {
      // Every session is signed out by the server; the auth context signs this device in again with the new password.
      const stillIn = await changePassword(current, next);
      if (!stillIn) return; // sent to the login screen
      setBusy(false);
      open(null);
      setNotice(t("Kata sandi sudah diubah. Perangkat lain sudah dikeluarkan dari akun ini.", "Your password has been changed. Other devices have been signed out of this account."));
    } catch (e) { fail(e); }
  }

  return (
    <Screen>
      <View style={{ flexDirection: "row" }}><Btn label={t("Kembali", "Back")} icon="arrowLeft" kind="ghost" small onPress={goBack} /></View>
      <T v="title" accessibilityRole="header">{t("Profil & pengaturan", "Profile & settings")}</T>

      <Card>
        <Chips<Lang> label={t("Bahasa", "Language")} value={lang} onChange={setLang}
          options={[{ key: "id", label: "Bahasa Indonesia" }, { key: "en", label: "English" }]} />
        <T v="small" muted style={{ marginTop: 10 }}>
          {t("Memengaruhi teks, angka, dan tanggal. Pesan kesalahan dari server masih berbahasa Indonesia.", "Affects text, numbers and dates. Error messages from the server are still in Indonesian.")}
        </T>
      </Card>

      <Card>
        <T v="heading">{t("Dukung Bandha", "Support Bandha")}</T>
        <T v="small" muted style={{ marginTop: 6, marginBottom: 12 }}>
          {t("Bantu membayar biaya server, domain, dan email lewat QRIS atau kripto.", "Help cover the server, domain and email costs with QRIS or crypto.")}
        </T>
        <Btn label={t("Buka halaman donasi", "Open the donation page")} icon="heart" kind="ghost" onPress={() => router.push("/donate")} />
      </Card>

      <Card>
        <T v="heading">{t("Akun", "Account")}</T>
        {user ? <><T style={{ marginTop: 6 }}>{user.name}</T><T v="small" muted>{user.email}</T></> : null}
        {notice ? <View style={{ marginTop: 10 }}><T v="small" color="#5B7A45">{notice}</T></View> : null}
        {error ? <View style={{ marginTop: 10 }}><Banner tone="err">{error}</Banner></View> : null}

        {panel === "name" ? (
          <View style={{ gap: 10, marginTop: 14 }}>
            <Field label={t("Nama", "Name")} value={name} onChangeText={setName} maxLength={80} autoComplete="name" hint={t("Nama ini dipakai untuk sapaan di Beranda.", "This name is used for the greeting on the dashboard.")} />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}><Btn label={t("Simpan", "Save")} onPress={saveName} busy={busy} disabled={!name.trim() || name.trim() === user?.name} /></View>
              <Btn label={t("Batal", "Cancel")} kind="ghost" onPress={() => open(null)} />
            </View>
          </View>
        ) : panel === "password" ? (
          <View style={{ gap: 10, marginTop: 14 }}>
            <Field label={t("Kata sandi saat ini", "Current password")} value={current} onChangeText={setCurrent} secureTextEntry autoCapitalize="none" autoComplete="current-password" maxLength={128} />
            <Field label={t("Kata sandi baru", "New password")} value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" autoComplete="new-password" maxLength={128}
              hint={t("Minimal 10 karakter. Setelah diganti, perangkat lain keluar dari akun ini.", "At least 10 characters. After changing it, other devices are signed out.")} />
            <Field label={t("Ulangi kata sandi baru", "Repeat the new password")} value={again} onChangeText={setAgain} secureTextEntry autoCapitalize="none" autoComplete="new-password" maxLength={128} />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}><Btn label={t("Simpan", "Save")} onPress={savePassword} busy={busy} /></View>
              <Btn label={t("Batal", "Cancel")} kind="ghost" onPress={() => open(null)} />
            </View>
          </View>
        ) : (
          <View style={{ gap: 8, marginTop: 14 }}>
            <Btn label={t("Ubah nama", "Change name")} kind="ghost" onPress={() => open("name")} />
            <Btn label={t("Ubah kata sandi", "Change password")} kind="ghost" onPress={() => open("password")} />
            {confirm ? (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}><Btn label={t("Ya, keluar", "Yes, sign out")} kind="danger" onPress={() => void signOut()} /></View>
                <Btn label={t("Batal", "Cancel")} kind="ghost" onPress={() => setConfirm(false)} />
              </View>
            ) : <Btn label={t("Keluar", "Sign out")} kind="ghost" onPress={() => setConfirm(true)} />}
          </View>
        )}
      </Card>
    </Screen>
  );
}
