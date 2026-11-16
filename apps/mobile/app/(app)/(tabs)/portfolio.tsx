import { router } from "expo-router";
import { Pressable, View } from "react-native";
import useSWR from "swr";
import { pct, qty, rp, signedRp, type Portfolio } from "@bandha/api-client";
import { Donut } from "../../../src/charts";
import { useT } from "../../../src/i18n";
import { useRefresh } from "../../../src/data";
import { CoinLogo } from "../../../src/logos";
import { SLICE, useTheme } from "../../../src/theme";
import { Banner, Btn, Card, Empty, Icon, Row, Screen, Skeleton, T } from "../../../src/ui";

export default function PortfolioScreen() {
  const c = useTheme();
  const t = useT();
  const { refreshing, refresh } = useRefresh();
  const { data: p, error } = useSWR<Portfolio>("/portfolio");
  // Allocation by asset (cash included): the six biggest, everything else merged into one slice.
  const valued = (p?.positions ?? []).filter((x) => x.marketValue !== null && Number(x.marketValue) > 0);
  const sum = valued.reduce((s, x) => s + Number(x.marketValue), 0);
  const restValue = valued.slice(6).reduce((s, x) => s + Number(x.marketValue), 0);
  const slices = [
    ...valued.slice(0, 6).map((x) => ({ key: x.assetId, label: x.symbol, value: Number(x.marketValue), percent: (Number(x.marketValue) / sum) * 100 })),
    ...(restValue > 0 ? [{ key: "others", label: t("Lainnya", "Others"), value: restValue, percent: (restValue / sum) * 100 }] : []),
  ];
  const toneColor = (v: string | null) => (v === null ? c.ink : Number(v) > 0 ? c.pos : Number(v) < 0 ? c.neg : c.ink);
  const open = (type: "buy" | "sell") => router.push({ pathname: "/add-transaction", params: { type } });

  return (
    <Screen onRefresh={refresh} refreshing={refreshing} bottomPad={96}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <T v="title" accessibilityRole="header">{t("Portofolio", "Portfolio")}</T>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Btn label={t("+ Beli", "+ Buy")} small onPress={() => open("buy")} />
          <Btn label={t("Jual", "Sell")} kind="ghost" small onPress={() => open("sell")} />
        </View>
      </View>
      <T v="small" muted>{t("Semua aset yang dimiliki, termasuk kas rupiah. Ketuk aset untuk melihat rekening yang menyimpannya, lalu ketuk rekening untuk mengelola aset di dalamnya.", "Everything you own, including rupiah cash. Tap an asset to see the accounts holding it, then tap an account to manage the assets inside.")}</T>

      {p && !p.complete ? <Banner tone="warn">{t(`Aset ${p.unpriced.join(", ")} belum punya harga pasar: modalnya tampil, tetapi nilai dan untung/ruginya belum dihitung.`, `${p.unpriced.join(", ")} has no market price yet: its cost is shown, but value and profit/loss are not calculated.`)}</Banner> : null}
      {error ? <Card><Empty title={t("Gagal memuat portofolio", "Failed to load portfolio")} action={<Btn label={t("Coba lagi", "Try again")} kind="ghost" small onPress={refresh} />} /></Card> : null}

      <View style={{ flexDirection: "row", gap: 12 }}>
        <Card style={{ flex: 1 }}>
          <T v="small" muted>{t("Nilai pasar (dengan kas)", "Market value (incl. cash)")}</T>
          {p ? <T v="mono" style={{ marginTop: 4 }}>{rp(p.totals.marketValue)}</T> : <Skeleton h={20} />}
        </Card>
        <Card style={{ flex: 1 }}>
          <T v="small" muted>{t("Modal aset (tanpa kas)", "Asset cost (excl. cash)")}</T>
          {p ? <T v="mono" style={{ marginTop: 4 }}>{rp(p.totals.costBasis)}</T> : <Skeleton h={20} />}
        </Card>
      </View>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Card style={{ flex: 1 }}>
          <T v="small" muted>{t("Belum terealisasi", "Unrealised")}</T>
          {p ? (
            <>
              <T v="mono" color={toneColor(p.totals.unrealizedPnl)} style={{ marginTop: 4 }}>{signedRp(p.totals.unrealizedPnl)}</T>
              {p.totals.unrealizedPct ? <T v="small" color={toneColor(p.totals.unrealizedPnl)}>{pct(p.totals.unrealizedPct)}</T> : null}
            </>
          ) : <Skeleton h={20} />}
        </Card>
        <Card style={{ flex: 1 }}>
          <T v="small" muted>{t("Terealisasi", "Realised")}</T>
          {p ? <T v="mono" color={toneColor(p.totals.realizedPnl)} style={{ marginTop: 4 }}>{signedRp(p.totals.realizedPnl)}</T> : <Skeleton h={20} />}
        </Card>
      </View>

      <Card>
        <T v="heading">{t("Alokasi aset", "Asset allocation")}</T>
        <T v="small" muted style={{ marginBottom: 10 }}>{t("Berdasarkan nilai pasar, termasuk kas", "By market value, including cash")}</T>
        {!p ? <Skeleton h={150} /> : slices.length === 0 ? <Empty title={t("Belum ada nilai pasar", "No market value yet")} /> : (
          <View style={{ gap: 16 }}>
            <View style={{ alignItems: "center" }}><Donut slices={slices.map((s) => ({ percent: s.percent }))} size={150} /></View>
            <View style={{ gap: 9 }}>
              {slices.map((s, i) => (
                <View key={s.key} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: SLICE[i % SLICE.length] }} />
                  <View style={{ flex: 1 }}><T numberOfLines={1}>{s.label}</T></View>
                  <T v="mono" style={{ fontSize: 12.5 }}>{rp(String(s.value))}</T>
                  <T v="small" muted style={{ width: 46, textAlign: "right" }}>{s.percent.toFixed(1)}%</T>
                </View>
              ))}
            </View>
          </View>
        )}
      </Card>

      <Card>
        <T v="heading">{t("Posisi", "Positions")}</T>
        {!p ? <Skeleton h={140} /> : p.positions.length === 0 ? (
          <Empty title={t("Belum ada posisi", "No positions yet")} text={t("Catat pembelian aset pertama Anda.", "Record your first asset purchase.")} action={<Btn label={t("+ Beli aset", "+ Buy asset")} small onPress={() => open("buy")} />} />
        ) : p.positions.map((x) => (
          <Pressable key={x.assetId} onPress={() => router.push(`/asset/${x.assetId}`)} accessibilityRole="button"
            accessibilityLabel={t(`Lihat rekening yang menyimpan ${x.symbol}`, `See accounts holding ${x.symbol}`)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <Row style={{ alignItems: "flex-start" }}>
              <CoinLogo symbol={x.symbol} size={36} />
              <View style={{ flex: 1, gap: 2 }}>
                <T>{x.symbol} <T v="small" muted>{x.name}</T></T>
                {x.cash ? (
                  <T v="small" muted>{t("Kas", "Cash")}{x.accounts.length > 1 ? t(` · ${x.accounts.length} rekening`, ` · ${x.accounts.length} accounts`) : ""}</T>
                ) : (
                  <>
                    <T v="small" muted>{qty(x.quantity)} · {t("rata-rata", "average")} {rp(x.avgCost)}</T>
                    <T v="small" muted>{t("modal", "cost")} {rp(x.costBasis)}{x.accounts.length > 1 ? t(` · ${x.accounts.length} rekening`, ` · ${x.accounts.length} accounts`) : ""}</T>
                  </>
                )}
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <T v="mono" style={{ fontSize: 13 }}>{x.marketValue === null ? t("Belum ada harga", "No price yet") : rp(x.marketValue)}</T>
                {x.cash ? <T v="small" muted>{qty(x.quantity)} {x.symbol}</T> : x.unrealizedPnl !== null ? (
                  <T v="small" color={toneColor(x.unrealizedPnl)}>{signedRp(x.unrealizedPnl)}{x.unrealizedPct ? ` · ${pct(x.unrealizedPct)}` : ""}</T>
                ) : null}
                {x.stale ? <T v="small" muted>{t("harga lama", "stale price")}</T> : null}
              </View>
              <Icon name="chevronRight" size={18} color={c.muted} />
            </Row>
          </Pressable>
        ))}
      </Card>

      {p && p.realized.length > 0 ? (
        <Card>
          <T v="heading">{t("Terealisasi per aset", "Realised per asset")}</T>
          {p.realized.map((r) => (
            <Row key={r.symbol}>
              <View style={{ flex: 1 }}><T>{r.symbol}</T></View>
              <T v="mono" style={{ fontSize: 13 }} color={toneColor(r.realized)}>{signedRp(r.realized)}</T>
            </Row>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
