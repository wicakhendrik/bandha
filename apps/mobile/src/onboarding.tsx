import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import useSWR, { mutate } from "swr";
import type { Onboarding } from "@bandha/api-client";
import { client } from "./api";
import { useT } from "./i18n";
import { useTheme } from "./theme";
import { Btn, Card, Icon, T } from "./ui";

/**
 * Getting-started guide on Home. Progress follows the person's real data (an account, then a first transaction), so it
 * ticks itself, and it disappears once both are done or when it is dismissed.
 */
export function OnboardingCard() {
  const c = useTheme();
  const t = useT();
  const { data } = useSWR<Onboarding>("/onboarding");
  const [busy, setBusy] = useState(false);
  if (!data?.show) return null;

  const steps = [
    {
      done: data.accounts > 0, title: t("Tambah rekening pertama", "Add your first account"),
      text: t("Bank, e-wallet, tunai, atau akun kripto. Isi saldo awalnya supaya angka di Bandha sama dengan yang sebenarnya.", "A bank, e-wallet, cash, or crypto account. Enter its opening balance so the numbers in Bandha match reality."),
      actions: <Btn label={t("Tambah rekening", "Add account")} onPress={() => router.push("/add-account")} />,
    },
    {
      done: data.transactions > 0, title: t("Catat transaksi pertama", "Record your first transaction"),
      text: data.accounts === 0 ? t("Tambah rekening dulu.", "Add an account first.") : t("Pengeluaran atau pemasukan hari ini. Atau masukkan mutasi bank sekaligus dari file CSV.", "An expense or income from today. Or bring in a bank statement from a CSV file in one go."),
      actions: (
        <View style={{ gap: 8 }}>
          <Btn label={t("Catat transaksi", "Add transaction")} disabled={data.accounts === 0} onPress={() => router.push("/add-transaction")} />
          {data.accounts > 0 ? <Btn label={t("Impor CSV", "Import CSV")} kind="ghost" onPress={() => router.push("/import-csv")} /> : null}
        </View>
      ),
    },
  ];
  const done = steps.filter((s) => s.done).length;

  async function dismiss() {
    setBusy(true);
    try { await client.dismissOnboarding(); await mutate("/onboarding"); } finally { setBusy(false); }
  }

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <T v="heading" accessibilityRole="header">{t("Mulai cepat", "Quick start")}</T>
          <T v="small" muted>{t("Dua langkah supaya Bandha langsung berguna.", "Two steps to make Bandha useful right away.")}</T>
        </View>
        <T v="small" muted accessibilityRole="text">{t(`${done} dari ${steps.length} selesai`, `${done} of ${steps.length} done`)}</T>
      </View>
      <View style={{ gap: 16, marginTop: 14 }}>
        {steps.map((s, i) => (
          <View key={i} style={{ flexDirection: "row", gap: 12 }}>
            <View
              accessibilityLabel={s.done ? t("selesai", "done") : t(`langkah ${i + 1}`, `step ${i + 1}`)}
              style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: s.done ? c.pos : c.gold, backgroundColor: s.done ? c.pos : "transparent", alignItems: "center", justifyContent: "center" }}>
              {s.done ? <Icon name="check" size={14} color="#fff" /> : <T v="small" color={c.sogan}>{i + 1}</T>}
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <T color={s.done ? c.muted : undefined}>{s.title}{s.done ? t(" — selesai", " — done") : ""}</T>
              {!s.done ? <T v="small" muted>{s.text}</T> : null}
              {!s.done ? <View style={{ marginTop: 4 }}>{s.actions}</View> : null}
            </View>
          </View>
        ))}
      </View>
      <View style={{ alignItems: "flex-end", marginTop: 8 }}><Btn label={t("Nanti saja", "Maybe later")} kind="ghost" small onPress={dismiss} busy={busy} /></View>
    </Card>
  );
}
