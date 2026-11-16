import { useState } from "react";
import { View } from "react-native";
import { useAuth } from "../../src/auth";
import { goBack } from "../../src/nav";
import { useLang, useT } from "../../src/i18n";
import { Btn, Card, Chips, Screen, T } from "../../src/ui";
import type { Lang } from "@bandha/api-client";

export default function Settings() {
  const t = useT();
  const { lang, setLang } = useLang();
  const { user, signOut } = useAuth();
  const [confirm, setConfirm] = useState(false);

  return (
    <Screen>
      <View style={{ flexDirection: "row" }}><Btn label={t("Kembali", "Back")} icon="arrowLeft" kind="ghost" small onPress={goBack} /></View>
      <T v="title" accessibilityRole="header">{t("Pengaturan", "Settings")}</T>

      <Card>
        <Chips<Lang> label={t("Bahasa", "Language")} value={lang} onChange={setLang}
          options={[{ key: "id", label: "Bahasa Indonesia" }, { key: "en", label: "English" }]} />
        <T v="small" muted style={{ marginTop: 10 }}>
          {t("Memengaruhi teks, angka, dan tanggal. Pesan kesalahan dari server masih berbahasa Indonesia.", "Affects text, numbers and dates. Error messages from the server are still in Indonesian.")}
        </T>
      </Card>

      <Card>
        <T v="heading">{t("Akun", "Account")}</T>
        {user ? <><T style={{ marginTop: 6 }}>{user.name}</T><T v="small" muted>{user.email}</T></> : null}
        <View style={{ marginTop: 14 }}>
          {confirm ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}><Btn label={t("Ya, keluar", "Yes, sign out")} kind="danger" onPress={() => void signOut()} /></View>
              <Btn label={t("Batal", "Cancel")} kind="ghost" onPress={() => setConfirm(false)} />
            </View>
          ) : <Btn label={t("Keluar", "Sign out")} kind="ghost" onPress={() => setConfirm(true)} />}
        </View>
      </Card>
    </Screen>
  );
}
