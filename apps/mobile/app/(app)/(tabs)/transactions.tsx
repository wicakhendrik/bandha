import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import useSWR, { mutate } from "swr";
import { ApiError, dateShort, txTypeLabel, txView, type Account, type Asset, type Tx } from "@bandha/api-client";
import { client } from "../../../src/api";
import { useRefresh } from "../../../src/data";
import { useT } from "../../../src/i18n";
import { useTheme } from "../../../src/theme";
import { Banner, Btn, Card, Empty, Row, Screen, Skeleton, T } from "../../../src/ui";

const PAGE = 30;

export default function Transactions() {
  const c = useTheme();
  const t = useT();
  const { refreshing, refresh } = useRefresh();
  const [limit, setLimit] = useState(PAGE);
  const { data, error } = useSWR<{ transactions: Tx[] }>(`/transactions?limit=${limit}`);
  const accs = useSWR<{ accounts: Account[] }>("/accounts");
  const assets = useSWR<{ assets: Asset[] }>("/assets");
  const [confirm, setConfirm] = useState<string | null>(null);
  // Errors belong next to the row the user acted on; a banner at the top is out of sight when scrolled.
  const [rowErr, setRowErr] = useState<{ id: string; text: string } | null>(null);

  const accountMap = new Map((accs.data?.accounts ?? []).map((a) => [a.id, a]));
  const assetMap = new Map((assets.data?.assets ?? []).map((a) => [a.id, a]));

  // Void, not delete: the amount is reversed and the audit trail stays in the ledger.
  async function voidTx(id: string) {
    setRowErr(null);
    try {
      await client.voidTransaction(id);
      setConfirm(null);
      await mutate(() => true);
    } catch (e) {
      setRowErr({ id, text: e instanceof ApiError ? e.message : t("Terjadi kesalahan", "Something went wrong") });
    }
  }

  return (
    <Screen onRefresh={refresh} refreshing={refreshing} bottomPad={96}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <T v="title" accessibilityRole="header">{t("Transaksi", "Transactions")}</T>
        <Btn label={t("Impor CSV", "Import CSV")} icon="arrowDown" kind="ghost" small onPress={() => router.push("/import-csv")} />
      </View>
      <Card>
        {error ? (
          <Empty title={t("Gagal memuat transaksi", "Failed to load transactions")} text={error instanceof Error ? error.message : undefined} action={<Btn label={t("Coba lagi", "Try again")} kind="ghost" small onPress={refresh} />} />
        ) : !data ? (
          <Skeleton h={160} />
        ) : data.transactions.length === 0 ? (
          <Empty title={t("Belum ada transaksi", "No transactions yet")} text={t("Ketuk tombol + untuk mencatat pemasukan atau pengeluaran.", "Tap the + button to record income or an expense.")} />
        ) : (
          <>
            {data.transactions.map((tx) => {
              const v = txView(tx, accountMap, assetMap);
              return (
                <Row key={tx.id} style={{ alignItems: "flex-start" }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <T numberOfLines={1}>{v.title}</T>
                    <T v="small" muted numberOfLines={1}>{dateShort(tx.occurredAt)} · {txTypeLabel(tx.type)} · {v.accountLabel}</T>
                    {rowErr?.id === tx.id ? <View style={{ marginTop: 6 }}><Banner tone="err">{rowErr.text}</Banner></View> : null}
                    {confirm === tx.id ? (
                      <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                        <Btn label={t("Batalkan transaksi", "Void transaction")} kind="danger" small onPress={() => voidTx(tx.id)} />
                        <Btn label={t("Tidak", "No")} kind="ghost" small onPress={() => setConfirm(null)} />
                      </View>
                    ) : (
                      <View style={{ flexDirection: "row", marginTop: 4, gap: 8 }}>
                        {tx.editable ? <Btn label={t("Edit", "Edit")} icon="edit" kind="ghost" small onPress={() => router.push({ pathname: "/add-transaction", params: { edit: tx.id } })} accessibilityLabel={t(`Edit transaksi ${v.title}`, `Edit transaction ${v.title}`)} /> : null}
                        <Btn label="Void" kind="ghost" small onPress={() => setConfirm(tx.id)} accessibilityLabel={t(`Batalkan transaksi ${v.title}`, `Void transaction ${v.title}`)} />
                      </View>
                    )}
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <T v="mono" style={{ fontSize: 13 }} color={v.tone === "pos" ? c.pos : v.tone === "neg" ? c.neg : c.ink}>{v.amount}</T>
                    {v.secondary ? <T v="small" muted>{v.secondary}</T> : null}
                  </View>
                </Row>
              );
            })}
            {data.transactions.length >= limit ? (
              <View style={{ marginTop: 12 }}><Btn label={t("Muat lebih banyak", "Load more")} kind="ghost" onPress={() => setLimit((l) => l + PAGE)} /></View>
            ) : null}
            <T v="small" muted style={{ marginTop: 12 }}>
              {t("“Void” membatalkan transaksi lewat jurnal pembalik. Riwayat audit tetap tersimpan. “Edit” membalik jurnal lama dan memasang jurnal pengganti.", "“Void” cancels a transaction with a reversal journal. The audit trail is kept. “Edit” reverses the old journal and posts a replacement.")}
            </T>
          </>
        )}
      </Card>
    </Screen>
  );
}
