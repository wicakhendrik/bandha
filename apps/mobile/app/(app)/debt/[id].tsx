import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import useSWR, { mutate } from "swr";
import { ApiError, dateShort, debtKindLabel, rp, todayKey, type DebtDetail } from "@bandha/api-client";
import { client } from "../../../src/api";
import { useRefresh } from "../../../src/data";
import { useT } from "../../../src/i18n";
import { ProgressBar } from "../../../src/debt-ui";
import { AccountLogo } from "../../../src/logos";
import { goBack } from "../../../src/nav";
import { useTheme } from "../../../src/theme";
import { Banner, Btn, Card, Empty, Row, Screen, Skeleton, T } from "../../../src/ui";

export default function DebtDetailScreen() {
  const c = useTheme();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { refreshing, refresh } = useRefresh();
  const { data, error } = useSWR<DebtDetail>(`/debts/${id}`);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const d = data?.debt;
  const payable = d?.direction === "payable";
  const overdue = !!d && d.status === "open" && !!d.dueDate && d.dueDate < todayKey();

  async function run(action: () => Promise<unknown>, after?: () => void) {
    setErr("");
    setBusy(true);
    try {
      await action();
      setConfirm(null);
      await mutate(() => true);
      after?.();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("Terjadi kesalahan", "Something went wrong"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <View style={{ flexDirection: "row" }}><Btn label={t("Utang & piutang", "Debts & receivables")} icon="arrowLeft" kind="ghost" small onPress={goBack} /></View>

      {error ? (
        <Card><Empty title={t("Tidak ditemukan", "Not found")} text={t("Data ini mungkin sudah dibatalkan.", "This record may have been cancelled.")} action={<Btn label={t("Kembali", "Back")} small onPress={goBack} />} /></Card>
      ) : !d || !data ? (
        <Card><Skeleton h={200} /></Card>
      ) : (
        <>
          <Card>
            <T v="small" muted>{payable ? t("Utang", "I owe") : t("Piutang", "Owed to me")} · {debtKindLabel(d.kind)}{d.status === "settled" ? t(" · Lunas", " · Settled") : ""}</T>
            <T v="title" accessibilityRole="header" numberOfLines={2}>{d.counterparty}</T>
            {d.note ? <T v="small" muted>{d.note}</T> : null}
            <T v="small" color={overdue ? c.neg : undefined} muted={!overdue}>
              {d.dueDate ? `${overdue ? t("Lewat jatuh tempo · ", "Overdue · ") : ""}${t("Jatuh tempo", "Due")} ${dateShort(`${d.dueDate}T12:00:00+07:00`)}` : t("Tanpa jatuh tempo", "No due date")}
            </T>

            <View style={{ marginTop: 14 }}>
              <T v="small" muted>{t("Sisa", "Remaining")}</T>
              <T v="monoBig" color={payable ? c.neg : c.pos}>{d.status === "settled" ? rp("0") : rp(d.remaining)}</T>
            </View>
            <View style={{ marginTop: 12, gap: 6 }}>
              <ProgressBar debt={d} />
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <T v="small" muted>{t("Pokok", "Principal")} {rp(d.principal)}</T>
                <T v="small" muted>{t("Terselesaikan", "Settled")} {rp(d.paid)} · {Math.round(d.progress)}%</T>
              </View>
            </View>

            {err ? <View style={{ marginTop: 12 }}><Banner tone="err">{err}</Banner></View> : null}

            <View style={{ gap: 10, marginTop: 16 }}>
              {d.status === "open" ? <Btn label={payable ? t("Bayar", "Repay") : t("Terima pembayaran", "Receive payment")} onPress={() => router.push({ pathname: "/settle-debt", params: { id: d.id } })} /> : null}
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}><Btn label={t("Edit", "Edit")} icon="edit" kind="ghost" onPress={() => router.push({ pathname: "/add-debt", params: { id: d.id } })} /></View>
                <View style={{ flex: 1 }}>
                  {confirm === "void"
                    ? <Btn label={t("Ya, batalkan", "Yes, cancel it")} kind="danger" busy={busy} onPress={() => run(() => client.voidDebt(d.id), () => router.replace("/debts"))} />
                    : <Btn label={t("Batalkan", "Cancel")} kind="danger" onPress={() => { setErr(""); setConfirm("void"); }} />}
                </View>
              </View>
              {confirm === "void" ? <T v="small" muted>{t("Membatalkan menghapus pinjaman ini dari catatan dan mengembalikan saldo rekening. Tidak bisa jika sudah ada pembayaran; batalkan pembayarannya dulu.", "Cancelling removes this loan from your records and restores the account balance. Not possible once payments exist; cancel the payments first.")}</T> : null}
            </View>
          </Card>

          <Card>
            <T v="heading">{t("Riwayat", "History")}</T>
            <T v="small" muted style={{ marginBottom: 4 }}>{t("Pinjaman awal dan setiap pembayaran, terbaru di atas.", "The original loan and every payment, newest first.")}</T>
            {data.history.map((h) => {
              const opening = h.type === "borrow" || h.type === "lend";
              const inflow = h.type === "borrow" || h.type === "collect";
              const label = opening ? (payable ? t("Pinjaman diterima", "Loan received") : t("Pinjaman diberikan", "Loan given")) : payable ? t("Pembayaran", "Payment") : t("Pembayaran diterima", "Payment received");
              return (
                <Row key={h.id} style={{ alignItems: "flex-start" }}>
                  {h.account ? <AccountLogo account={h.account} size={36} /> : <View style={{ width: 36 }} />}
                  <View style={{ flex: 1, gap: 2 }}>
                    <T numberOfLines={1}>{label}</T>
                    <T v="small" muted>
                      {dateShort(h.occurredAt)} · {h.account ? t(`lewat ${h.account.name}`, `via ${h.account.name}`) : t("kontrak yang sudah ada sebelumnya", "pre-existing contract")}
                      {Number(h.interest) > 0 ? t(` · bunga ${rp(h.interest)}`, ` · interest ${rp(h.interest)}`) : ""}{h.note ? ` · ${h.note}` : ""}
                    </T>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 6 }}>
                    <T v="mono" style={{ fontSize: 13 }} color={inflow ? c.pos : c.neg}>{inflow ? "+" : "−"}{rp(h.amount)}</T>
                    {!opening ? (
                      confirm === h.id
                        ? <Btn label={t("Ya, batalkan", "Yes, cancel it")} kind="danger" small busy={busy} onPress={() => run(() => client.voidTransaction(h.id))} />
                        : <Btn label={t("Batalkan", "Undo")} kind="ghost" small accessibilityLabel={t(`Batalkan pembayaran ${rp(h.amount)}`, `Undo payment ${rp(h.amount)}`)} onPress={() => { setErr(""); setConfirm(h.id); }} />
                    ) : null}
                  </View>
                </Row>
              );
            })}
          </Card>
        </>
      )}
    </Screen>
  );
}
