import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import useSWR, { mutate } from "swr";
import { ApiError, accountKindLabel, dateShort, ledgerRowView, qty, rp, type AccountLedger } from "@bandha/api-client";
import { client } from "../../../src/api";
import { useRefresh } from "../../../src/data";
import { useT } from "../../../src/i18n";
import { AccountLogo, CoinLogo } from "../../../src/logos";
import { goBack } from "../../../src/nav";
import { useTheme } from "../../../src/theme";
import { Banner, Btn, Card, Chips, Empty, Row, Screen, Skeleton, T } from "../../../src/ui";

const PAGE = 30;

export default function AccountDetail() {
  const c = useTheme();
  const t = useT();
  const { accountId, asset } = useLocalSearchParams<{ accountId: string; asset?: string }>();
  const { refreshing, refresh } = useRefresh();
  const [limit, setLimit] = useState(PAGE);
  const { data, error } = useSWR<AccountLedger>(`/accounts/${accountId}/ledger?limit=${limit}${asset ? `&assetId=${asset}` : ""}`);

  const [confirm, setConfirm] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<{ id: string; text: string } | null>(null);

  // Void, not delete: the amount is reversed and the audit trail stays in the ledger.
  async function voidTx(id: string, rowKey: string) {
    setRowErr(null);
    try {
      await client.voidTransaction(id);
      setConfirm(null);
      await mutate(() => true);
    } catch (e) {
      setRowErr({ id: rowKey, text: e instanceof ApiError ? e.message : t("Terjadi kesalahan", "Something went wrong") });
    }
  }

  const setAsset = (next: string) => router.setParams({ asset: next === "all" ? undefined : next });
  const backLabel = data?.asset ? data.asset.symbol : t("Kembali", "Back");

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <View style={{ flexDirection: "row" }}><Btn label={backLabel} icon="arrowLeft" kind="ghost" small onPress={goBack} /></View>

      {error ? (
        <Card><Empty title={t("Rekening tidak ditemukan", "Account not found")} text={t("Rekening mungkin sudah tidak tersedia.", "The account may no longer be available.")} action={<Btn label={t("Kembali", "Back")} small onPress={goBack} />} /></Card>
      ) : !data ? (
        <Card><Skeleton h={200} /></Card>
      ) : (
        <>
          <Card>
            <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
              <AccountLogo account={data.account} size={56} />
              <View style={{ flex: 1 }}>
                <T v="small" muted>{accountKindLabel(data.account.kind)}{data.account.includeInNetWorth ? "" : t(" · tidak dihitung", " · not counted")}</T>
                <T v="title" accessibilityRole="header" numberOfLines={2}>{data.account.name}</T>
              </View>
            </View>
            <View style={{ marginTop: 14 }}>
              <T v="small" muted>{t("Saldo (nilai pasar)", "Balance (market value)")}</T>
              <T v="monoBig">{rp(data.totalValue)}</T>
              {!data.complete ? <T v="small" muted>{t("sebagian aset belum punya harga", "some assets have no price yet")}</T> : null}
            </View>
            {data.balances.length > 0 ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                {data.balances.map((b) => (
                  <View key={b.assetId} style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.mori, borderRadius: 99, paddingVertical: 4, paddingLeft: 4, paddingRight: 10 }}>
                    <CoinLogo symbol={b.symbol} size={22} />
                    <T v="mono" style={{ fontSize: 12 }}>{qty(b.quantity)} {b.symbol}</T>
                  </View>
                ))}
              </View>
            ) : null}
          </Card>

          {data.balances.length > 1 || data.asset ? (
            <Chips label={t("Filter aset", "Filter by asset")} value={data.asset?.id ?? "all"} onChange={setAsset}
              options={[{ key: "all", label: t("Semua aset", "All assets") }, ...data.balances.map((b) => ({ key: b.assetId, label: b.symbol }))]} />
          ) : null}

          <Card>
            <T v="heading">{t("Transaksi", "Transactions")}{data.asset ? ` ${data.asset.symbol}` : ""}</T>
            <T v="small" muted style={{ marginBottom: 4 }}>{t("Terbaru di atas. Saldo menunjukkan jumlah setelah transaksi itu.", "Newest first. Balance is the amount after that transaction.")}</T>
            {data.rows.length === 0 ? (
              <Empty title={t("Belum ada transaksi", "No transactions yet")} text={data.asset ? t(`Belum ada transaksi ${data.asset.symbol} di rekening ini.`, `No ${data.asset.symbol} transactions in this account yet.`) : t("Catat pemasukan, pengeluaran, atau transfer.", "Record income, expenses or transfers.")} />
            ) : (
              <>
                {data.rows.map((r) => {
                  const v = ledgerRowView(r);
                  const rowKey = `${r.transactionId}-${r.assetId}`;
                  return (
                    <Row key={rowKey} style={{ alignItems: "flex-start" }}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                          <View style={{ flex: 1 }}><T numberOfLines={1}>{v.title}</T></View>
                          <T v="mono" style={{ fontSize: 13, flexShrink: 0 }} color={v.tone === "pos" ? c.pos : c.neg}>{v.amount}</T>
                        </View>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                          <View style={{ flex: 1 }}><T v="small" muted numberOfLines={1}>{dateShort(r.occurredAt)} · {v.typeLabel}{!data.asset && r.symbol !== "IDR" ? ` · ${r.symbol}` : ""}</T></View>
                          {v.secondary ? <T v="small" muted style={{ flexShrink: 0 }}>{v.secondary}</T> : null}
                        </View>
                        <T v="small" muted>{t("Saldo", "Balance")} {v.balance}</T>
                        {rowErr?.id === rowKey ? <View style={{ marginTop: 6 }}><Banner tone="err">{rowErr.text}</Banner></View> : null}
                        {confirm === rowKey ? (
                          <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                            <Btn label={t("Batalkan", "Void")} kind="danger" small onPress={() => voidTx(r.transactionId, rowKey)} accessibilityLabel={t(`Batalkan transaksi ${v.title}`, `Void transaction ${v.title}`)} />
                            <Btn label={t("Tidak", "No")} kind="ghost" small onPress={() => setConfirm(null)} />
                          </View>
                        ) : (
                          <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                            {r.editable !== false ? <Btn label="Edit" icon="edit" kind="ghost" small onPress={() => router.push({ pathname: "/add-transaction", params: { edit: r.transactionId } })} accessibilityLabel={t(`Edit transaksi ${v.title}`, `Edit transaction ${v.title}`)} /> : null}
                            <Btn label="Void" kind="ghost" small onPress={() => setConfirm(rowKey)} accessibilityLabel={t(`Batalkan transaksi ${v.title}`, `Void transaction ${v.title}`)} />
                          </View>
                        )}
                      </View>
                    </Row>
                  );
                })}
                {data.hasMore ? <View style={{ marginTop: 12 }}><Btn label={t("Muat lebih banyak", "Load more")} kind="ghost" onPress={() => setLimit((l) => l + PAGE)} /></View> : null}
              </>
            )}
          </Card>
        </>
      )}
    </Screen>
  );
}
