import { router, useLocalSearchParams } from "expo-router";
import { Pressable, View } from "react-native";
import useSWR from "swr";
import { accountKindLabel, assetKindLabel, qty, rp, type Holdings } from "@bandha/api-client";
import { useRefresh } from "../../../src/data";
import { useT } from "../../../src/i18n";
import { AccountLogo, CoinLogo } from "../../../src/logos";
import { goBack } from "../../../src/nav";
import { useTheme } from "../../../src/theme";
import { Btn, Card, Empty, Icon, Row, Screen, Skeleton, T } from "../../../src/ui";

export default function AssetDetail() {
  const c = useTheme();
  const t = useT();
  const { assetId } = useLocalSearchParams<{ assetId: string }>();
  const { refreshing, refresh } = useRefresh();
  const { data, error } = useSWR<Holdings>("/holdings");
  const asset = data?.assets.find((a) => a.assetId === assetId);

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <View style={{ flexDirection: "row" }}><Btn label={t("Portofolio", "Portfolio")} icon="arrowLeft" kind="ghost" small onPress={goBack} /></View>

      {error ? (
        <Card><Empty title={t("Gagal memuat aset", "Failed to load asset")} action={<Btn label={t("Coba lagi", "Try again")} kind="ghost" small onPress={refresh} />} /></Card>
      ) : !data ? (
        <Card><Skeleton h={160} /></Card>
      ) : !asset ? (
        <Card><Empty title={t("Aset tidak ditemukan", "Asset not found")} text={t("Aset ini belum punya saldo di rekening mana pun, atau rekeningnya sudah diarsipkan.", "This asset has no balance in any account, or its accounts are archived.")} action={<Btn label={t("Kembali", "Back")} small onPress={goBack} />} /></Card>
      ) : (
        <>
          <Card>
            <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
              <CoinLogo symbol={asset.symbol} size={56} />
              <View style={{ flex: 1 }}>
                <T v="small" muted>{assetKindLabel(asset.kind)}</T>
                <T v="title" accessibilityRole="header">{asset.symbol}</T>
                <T v="small" muted>{asset.name}</T>
              </View>
            </View>
            <View style={{ marginTop: 16, gap: 10 }}>
              <View><T v="small" muted>{t("Total jumlah", "Total quantity")}</T><T v="monoBig">{qty(asset.quantity)} <T v="small" muted>{asset.symbol}</T></T></View>
              <View style={{ flexDirection: "row", gap: 16 }}>
                <View style={{ flex: 1 }}><T v="small" muted>{t("Nilai pasar", "Market value")}</T><T v="mono">{asset.value === null ? "—" : rp(asset.value)}</T></View>
                <View style={{ flex: 1 }}><T v="small" muted>{t("Harga per unit", "Price per unit")}</T><T v="mono">{asset.price === null ? t("Belum ada harga", "No price yet") : rp(asset.price)}</T>{asset.stale ? <T v="small" muted>{t("harga lama", "stale price")}</T> : null}</View>
              </View>
            </View>
          </Card>

          <Card>
            <T v="heading">{t(`Rekening yang menyimpan ${asset.symbol}`, `Accounts holding ${asset.symbol}`)}</T>
            <T v="small" muted style={{ marginBottom: 4 }}>{t(`Ketuk rekening untuk melihat transaksi ${asset.symbol} di rekening itu.`, `Tap an account to see its ${asset.symbol} transactions.`)}</T>
            {asset.accounts.map((a) => (
              <Pressable key={a.accountId} onPress={() => router.push(`/account/${a.accountId}?asset=${asset.assetId}`)} accessibilityRole="button"
                accessibilityLabel={t(`Lihat transaksi ${asset.symbol} di ${a.name}`, `See ${asset.symbol} transactions in ${a.name}`)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                <Row>
                  <AccountLogo account={a} size={40} />
                  <View style={{ flex: 1 }}>
                    <T numberOfLines={1}>{a.name}</T>
                    <T v="small" muted>{accountKindLabel(a.kind)}</T>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <T v="mono" style={{ fontSize: 13 }}>{qty(a.quantity)} {asset.symbol}</T>
                    {a.value !== null ? <T v="small" muted>{rp(a.value)}</T> : null}
                  </View>
                  <Icon name="chevronRight" size={18} color={c.muted} />
                </Row>
              </Pressable>
            ))}
            <T v="small" muted style={{ marginTop: 10 }}>{t(`${asset.accounts.length} rekening menyimpan ${asset.symbol}.`, `${asset.accounts.length} accounts hold ${asset.symbol}.`)}</T>
          </Card>
        </>
      )}
    </Screen>
  );
}
