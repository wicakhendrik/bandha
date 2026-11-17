import { router } from "expo-router";
import { Pressable, View } from "react-native";
import useSWR from "swr";
import { pct, qty, rp, signedRp, type Portfolio } from "@bandha/api-client";
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
  // Sub-rupiah leftovers from rounding are not worth a row.
  const realizedShown = (p?.realized ?? []).filter((r) => Math.abs(Number(r.realized)) >= 0.5);
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

      <Card>
        <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 14 }}>
          <View style={{ width: "50%", paddingRight: 8 }}>
            <T v="small" muted>{t("Nilai pasar (dengan kas)", "Market value (incl. cash)")}</T>
            {p ? <T v="mono" style={{ marginTop: 2 }}>{rp(p.totals.marketValue)}</T> : <Skeleton h={20} />}
          </View>
          <View style={{ width: "50%", paddingLeft: 8 }}>
            <T v="small" muted>{t("Modal aset (tanpa kas)", "Asset cost (excl. cash)")}</T>
            {p ? <T v="mono" style={{ marginTop: 2 }}>{rp(p.totals.costBasis)}</T> : <Skeleton h={20} />}
          </View>
          <View style={{ width: "50%", paddingRight: 8 }}>
            <T v="small" muted>{t("Belum terealisasi", "Unrealised")}</T>
            {p ? (
              <>
                <T v="mono" color={toneColor(p.totals.unrealizedPnl)} style={{ marginTop: 2 }}>{signedRp(p.totals.unrealizedPnl)}</T>
                {p.totals.unrealizedPct ? <T v="small" color={toneColor(p.totals.unrealizedPnl)}>{pct(p.totals.unrealizedPct)}</T> : null}
              </>
            ) : <Skeleton h={20} />}
          </View>
          <View style={{ width: "50%", paddingLeft: 8 }}>
            <T v="small" muted>{t("Terealisasi", "Realised")}</T>
            {p ? <T v="mono" color={toneColor(p.totals.realizedPnl)} style={{ marginTop: 2 }}>{signedRp(p.totals.realizedPnl)}</T> : <Skeleton h={20} />}
          </View>
        </View>

        {p && slices.length > 0 ? (
          <View style={{ marginTop: 16, gap: 10 }}>
            <T v="small" muted>{t("Alokasi aset (nilai pasar, termasuk kas)", "Asset allocation (market value, incl. cash)")}</T>
            <View accessibilityRole="image" accessibilityLabel={t("Alokasi aset menurut nilai pasar", "Asset allocation by market value")} style={{ flexDirection: "row", height: 12, borderRadius: 6, overflow: "hidden", backgroundColor: c.mori }}>
              {slices.map((s, i) => <View key={s.key} style={{ width: `${s.percent}%`, backgroundColor: SLICE[i % SLICE.length] }} />)}
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 4 }}>
              {slices.map((s, i) => (
                <View key={s.key} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: SLICE[i % SLICE.length] }} />
                  <T v="small">{s.label} <T v="small" muted>{s.percent.toFixed(1)}%</T></T>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </Card>

      <Card>
        <T v="heading">{t("Posisi", "Positions")}</T>
        {!p ? <Skeleton h={140} /> : p.positions.length === 0 ? (
          <Empty title={t("Belum ada posisi", "No positions yet")} text={t("Catat pembelian aset pertama Anda.", "Record your first asset purchase.")} action={<Btn label={t("+ Beli aset", "+ Buy asset")} small onPress={() => open("buy")} />} />
        ) : p.positions.map((x) => (
          <Pressable key={x.assetId} onPress={() => router.push(`/asset/${x.assetId}`)} accessibilityRole="button"
            accessibilityLabel={t(`Lihat rekening yang menyimpan ${x.symbol}`, `See accounts holding ${x.symbol}`)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <Row>
              <CoinLogo symbol={x.symbol} size={34} />
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <View style={{ flexShrink: 1 }}><T numberOfLines={1}>{x.symbol}{x.cash ? <T v="small" muted>{` · ${t("Kas", "Cash")}`}</T> : null}</T></View>
                  <T v="mono" style={{ fontSize: 13 }}>{x.marketValue === null ? t("Belum ada harga", "No price yet") : rp(x.marketValue)}</T>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <View style={{ flexShrink: 1 }}><T v="small" muted numberOfLines={1}>{qty(x.quantity)}{x.cash ? "" : ` ${x.symbol}`}{x.accounts.length > 1 ? t(` · ${x.accounts.length} rekening`, ` · ${x.accounts.length} accounts`) : ""}{x.stale ? ` · ${t("harga lama", "stale price")}` : ""}</T></View>
                  {x.cash || x.unrealizedPnl === null ? null : <T v="small" color={toneColor(x.unrealizedPnl)}>{signedRp(x.unrealizedPnl)}{x.unrealizedPct ? ` · ${pct(x.unrealizedPct)}` : ""}</T>}
                </View>
              </View>
              <Icon name="chevronRight" size={16} color={c.muted} />
            </Row>
          </Pressable>
        ))}
      </Card>

      {p && realizedShown.length > 0 ? (
        <Card>
          <T v="heading">{t("Terealisasi per aset", "Realised per asset")}</T>
          {realizedShown.map((r) => (
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
