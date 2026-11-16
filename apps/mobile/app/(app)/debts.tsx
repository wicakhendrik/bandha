import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import useSWR from "swr";
import { dateShort, debtKindLabel, rp, todayKey, type Debt, type DebtList } from "@bandha/api-client";
import { useRefresh } from "../../src/data";
import { useT } from "../../src/i18n";
import { ProgressBar } from "../../src/debt-ui";
import { goBack } from "../../src/nav";
import { useTheme } from "../../src/theme";
import { Btn, Card, Chips, Empty, Screen, Skeleton, T } from "../../src/ui";

type Filter = "all" | "payable" | "receivable";

export default function Debts() {
  const c = useTheme();
  const t = useT();
  const { refreshing, refresh } = useRefresh();
  const { data, error } = useSWR<DebtList>("/debts");
  const [filter, setFilter] = useState<Filter>("all");
  const all = data?.debts ?? [];
  const shown = all.filter((d) => filter === "all" || d.direction === filter);
  const today = todayKey();

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Btn label={t("Kembali", "Back")} icon="arrowLeft" kind="ghost" small onPress={goBack} />
        <Btn label={t("Tambah", "Add")} icon="plus" small onPress={() => router.push({ pathname: "/add-debt", params: { direction: filter === "receivable" ? "receivable" : "payable" } })} />
      </View>
      <T v="title" accessibilityRole="header">{t("Utang & piutang", "Debts & receivables")}</T>
      <T v="small" muted>{t("Utang mengurangi dan piutang menambah total kekayaan bersih.", "Debts lower and receivables raise your net worth.")}</T>

      <View style={{ flexDirection: "row", gap: 12 }}>
        <Card style={{ flex: 1 }}>
          <T v="small" muted>{t("Total utang saya", "Total I owe")}</T>
          {data ? <T v="mono" color={c.neg} style={{ marginTop: 4 }}>{rp(data.totals.payable)}</T> : <Skeleton h={20} />}
        </Card>
        <Card style={{ flex: 1 }}>
          <T v="small" muted>{t("Total piutang saya", "Total owed to me")}</T>
          {data ? <T v="mono" color={c.pos} style={{ marginTop: 4 }}>{rp(data.totals.receivable)}</T> : <Skeleton h={20} />}
        </Card>
      </View>

      <Chips<Filter> label={t("Filter utang dan piutang", "Filter debts and receivables")} value={filter} onChange={setFilter}
        options={[{ key: "all", label: t("Semua", "All") }, { key: "payable", label: t("Utang", "I owe") }, { key: "receivable", label: t("Piutang", "Owed to me") }]} />

      {error ? (
        <Card><Empty title={t("Gagal memuat utang & piutang", "Failed to load debts & receivables")} action={<Btn label={t("Coba lagi", "Try again")} kind="ghost" small onPress={refresh} />} /></Card>
      ) : !data ? (
        <Card><Skeleton h={160} /></Card>
      ) : all.length === 0 ? (
        <Card><Empty title={t("Belum ada utang atau piutang", "No debts or receivables yet")} text={t("Catat pinjaman yang Anda terima atau berikan, lalu catat pembayarannya di sini.", "Record a loan you took or gave, then record its payments here.")} /></Card>
      ) : shown.length === 0 ? (
        <Card><Empty title={t("Tidak ada yang cocok dengan filter ini", "Nothing matches this filter")} /></Card>
      ) : (
        <Card>
          {shown.map((d, i) => {
            const overdue = d.status === "open" && !!d.dueDate && d.dueDate < today;
            return (
              <Pressable key={d.id} onPress={() => router.push({ pathname: "/debt/[id]", params: { id: d.id } })} accessibilityRole="button"
                accessibilityLabel={t(`${d.counterparty}, sisa ${rp(d.remaining)}`, `${d.counterparty}, ${rp(d.remaining)} left`)}
                style={{ gap: 8, paddingVertical: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: c.line, borderStyle: "dashed" }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <T numberOfLines={1}>{d.counterparty}</T>
                    <T v="small" muted numberOfLines={1}>
                      {d.direction === "payable" ? t("Utang", "I owe") : t("Piutang", "Owed to me")} · {debtKindLabel(d.kind)}{d.status === "settled" ? t(" · Lunas", " · Settled") : ""}
                    </T>
                  </View>
                  <T v="mono" style={{ fontSize: 14 }} color={d.direction === "payable" ? c.neg : c.pos}>{d.status === "settled" ? rp("0") : rp(d.remaining)}</T>
                </View>
                <ProgressBar debt={d} />
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <T v="small" muted>{t(`dari ${rp(d.principal)}`, `of ${rp(d.principal)}`)}</T>
                  <T v="small" color={overdue ? c.neg : undefined} muted={!overdue}>
                    {d.dueDate ? `${overdue ? t("Lewat jatuh tempo · ", "Overdue · ") : ""}${t("Jatuh tempo", "Due")} ${dateShort(`${d.dueDate}T12:00:00+07:00`)}` : t("Tanpa jatuh tempo", "No due date")}
                  </T>
                </View>
              </Pressable>
            );
          })}
        </Card>
      )}
    </Screen>
  );
}
