import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import useSWR from "swr";
import { dateShort, monthYear, rp, shiftMonth, todayKey, txTypeLabel, type CashflowDetail } from "@bandha/api-client";
import { Donut } from "../../../src/charts";
import { useRefresh } from "../../../src/data";
import { useT } from "../../../src/i18n";
import { AccountLogo } from "../../../src/logos";
import { goBack } from "../../../src/nav";
import { SLICE, useTheme } from "../../../src/theme";
import { Btn, Card, Empty, Icon, Row, Screen, Skeleton, T } from "../../../src/ui";

const MAX_SLICES = 7;

export default function CashflowDetailScreen() {
  const c = useTheme();
  const t = useT();
  const { kind } = useLocalSearchParams<{ kind: string }>();
  const income = kind === "income";
  const valid = kind === "income" || kind === "expense";
  const thisMonth = todayKey().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const { refreshing, refresh } = useRefresh();
  const { data, error } = useSWR<CashflowDetail>(valid ? `/dashboard/cashflow/${kind}?month=${month}` : null);

  const cats = data?.categories ?? [];
  const slices = [
    ...cats.slice(0, MAX_SLICES).map((x) => ({ label: t("Tanpa kategori", "Uncategorised"), total: Number(x.total), percent: Number(x.percent) })),
    ...(cats.length > MAX_SLICES
      ? [{ label: t("Lainnya", "Others"), total: cats.slice(MAX_SLICES).reduce((s, x) => s + Number(x.total), 0), percent: cats.slice(MAX_SLICES).reduce((s, x) => s + Number(x.percent), 0) }]
      : []),
  ];
  const tone = income ? c.pos : c.neg;

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <View style={{ flexDirection: "row" }}><Btn label={t("Beranda", "Home")} icon="arrowLeft" kind="ghost" small onPress={goBack} /></View>
      <T v="title" accessibilityRole="header">{income ? t("Detail pemasukan", "Income details") : t("Detail pengeluaran", "Expense details")}</T>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14 }}>
        <Pressable onPress={() => setMonth((m) => shiftMonth(m, -1))} accessibilityRole="button" accessibilityLabel={t("Bulan sebelumnya", "Previous month")} hitSlop={10}
          style={{ width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: c.card, alignItems: "center", justifyContent: "center" }}>
          <Icon name="chevronLeft" size={20} color={c.ink} />
        </Pressable>
        <T v="heading" style={{ minWidth: 150, textAlign: "center" }}>{monthYear(month)}</T>
        <Pressable onPress={() => setMonth((m) => shiftMonth(m, 1))} disabled={month >= thisMonth} accessibilityRole="button" accessibilityLabel={t("Bulan berikutnya", "Next month")} hitSlop={10}
          style={{ width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: c.card, alignItems: "center", justifyContent: "center", opacity: month >= thisMonth ? 0.35 : 1 }}>
          <Icon name="chevronRight" size={20} color={c.ink} />
        </Pressable>
      </View>

      {!valid || error ? (
        <Card><Empty title={t("Gagal memuat detail", "Failed to load details")} action={<Btn label={t("Coba lagi", "Try again")} kind="ghost" small onPress={refresh} />} /></Card>
      ) : !data ? (
        <Card><Skeleton h={220} /></Card>
      ) : (
        <>
          <Card>
            <T v="small" muted>{income ? t("Total pemasukan", "Total income") : t("Total pengeluaran", "Total expenses")}</T>
            <T v="monoBig" color={tone} style={{ fontSize: 28, lineHeight: 36 }}>{rp(data.total)}</T>
            <T v="small" muted>{t(`${data.transactions.length} transaksi`, `${data.transactions.length} transactions`)}</T>

            <T v="heading" style={{ marginTop: 18, marginBottom: 10 }}>{t("Berdasarkan kategori", "By category")}</T>
            {slices.length === 0 ? (
              <Empty title={income ? t("Belum ada pemasukan di bulan ini", "No income this month") : t("Belum ada pengeluaran di bulan ini", "No expenses this month")} text={t("Coba bulan lain atau catat transaksi baru.", "Try another month or record a new transaction.")} />
            ) : (
              <View style={{ gap: 16 }}>
                <View style={{ alignItems: "center" }}><Donut slices={slices.map((s) => ({ percent: s.percent }))} size={150} /></View>
                <View style={{ gap: 9 }}>
                  {slices.map((s, i) => (
                    <View key={`${s.label}-${i}`} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: SLICE[i % SLICE.length] }} />
                      <View style={{ flex: 1 }}><T numberOfLines={1}>{s.label}</T></View>
                      <T v="mono" style={{ fontSize: 12.5 }}>{rp(String(s.total))}</T>
                      <T v="small" muted style={{ width: 46, textAlign: "right" }}>{s.percent.toFixed(1)}%</T>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </Card>

          <Card>
            <T v="heading">{t("Transaksi", "Transactions")}</T>
            <T v="small" muted style={{ marginBottom: 4 }}>{monthYear(month)}</T>
            {data.transactions.length === 0 ? (
              <Empty title={income ? t("Belum ada pemasukan di bulan ini", "No income this month") : t("Belum ada pengeluaran di bulan ini", "No expenses this month")} />
            ) : data.transactions.map((tx) => {
              // A fee that belongs to a purchase or a sale is shown as such.
              const title = tx.type === "buy" || tx.type === "sell" ? t(`Biaya ${txTypeLabel(tx.type).toLowerCase()}`, `${txTypeLabel(tx.type)} fee`) : tx.description || tx.category || txTypeLabel(tx.type);
              return (
                <Row key={`${tx.id}-${tx.amount}`}>
                  {tx.account ? <AccountLogo account={tx.account} size={36} /> : <View style={{ width: 36 }} />}
                  <View style={{ flex: 1 }}>
                    <T numberOfLines={1}>{title}</T>
                    <T v="small" muted numberOfLines={1}>{dateShort(tx.occurredAt)}{tx.account ? ` · ${tx.account.name}` : ""}{tx.category && tx.category !== title ? ` · ${tx.category}` : ""}</T>
                  </View>
                  <T v="mono" style={{ fontSize: 13 }} color={tone}>{income ? "+" : "−"}{rp(tx.amount)}</T>
                </Row>
              );
            })}
          </Card>
        </>
      )}
    </Screen>
  );
}
