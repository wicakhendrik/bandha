import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import useSWR, { mutate } from "swr";
import { ApiError, isAmount, isAmountOrZero, isDateKey, rp, todayKey, type Account, type DebtDetail } from "@bandha/api-client";
import { client } from "../../src/api";
import { newIdempotencyKey } from "../../src/data";
import { useT } from "../../src/i18n";
import { AccountLogo } from "../../src/logos";
import { SearchPicker, type PickerOption } from "../../src/picker";
import { Banner, Btn, Field, Screen, T } from "../../src/ui";

/** Repay (utang) or receive a payment (piutang); interest is booked separately as expense / income. */
export default function SettleDebt() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const accs = useSWR<{ accounts: Account[] }>("/accounts");
  const detail = useSWR<DebtDetail>(id ? `/debts/${id}` : null);
  const accounts = accs.data?.accounts ?? [];
  const debt = detail.data?.debt;
  const payable = debt?.direction === "payable";

  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [interest, setInterest] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef(newIdempotencyKey());

  const effAccount = accounts.some((a) => a.id === accountId) ? accountId : (accounts[0]?.id ?? "");
  const options: PickerOption[] = accounts.map((a) => ({ value: a.id, label: a.name, icon: <AccountLogo account={a} size={30} />, keywords: a.kind }));
  const total = isAmount(amount) ? Number(amount) + (interest && isAmountOrZero(interest) ? Number(interest) : 0) : null;

  async function submit() {
    setError("");
    if (!debt || !id) return;
    if (!effAccount) return setError(t("Pilih rekening", "Choose an account"));
    if (!isAmount(amount)) return setError(t("Jumlah harus angka lebih dari 0", "Amount must be a number above 0"));
    if (Number(amount) > Number(debt.remaining)) return setError(t(`Jumlah melebihi sisa (${rp(debt.remaining)})`, `Amount exceeds what is left (${rp(debt.remaining)})`));
    if (interest && !isAmountOrZero(interest)) return setError(t("Bunga harus berupa angka", "Interest must be a number"));
    if (!isDateKey(date)) return setError(t("Tanggal harus berformat TTTT-BB-HH", "Date must be YYYY-MM-DD"));
    setBusy(true);
    try {
      await client.settleDebt(id, {
        accountId: effAccount, amount,
        ...(interest && Number(interest) > 0 ? { interest } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        occurredAt: new Date(`${date}T12:00:00+07:00`).toISOString(),
        idempotencyKey: key.current,
      });
      await mutate(() => true);
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? (e.issues?.[0] ? `${e.issues[0].path}: ${e.issues[0].message}` : e.message) : t("Terjadi kesalahan", "Something went wrong"));
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <T v="title" accessibilityRole="header">{payable ? t("Bayar utang", "Repay debt") : t("Terima pembayaran", "Receive payment")}</T>
          <Btn label={t("Tutup", "Close")} kind="ghost" small onPress={() => router.back()} />
        </View>
        {error ? <Banner tone="err">{error}</Banner> : null}
        {debt ? <T muted><T>{debt.counterparty}</T> · {t(`sisa ${rp(debt.remaining)}`, `${rp(debt.remaining)} left`)}</T> : null}
        {accs.data && accounts.length === 0 ? <Banner tone="warn">{t("Belum ada rekening. Tambahkan rekening terlebih dulu.", "No accounts yet. Add an account first.")}</Banner> : null}

        {options.length > 0 ? <SearchPicker label={payable ? t("Dibayar dari rekening", "Paid from account") : t("Masuk ke rekening", "Received into account")} options={options} value={effAccount} onChange={setAccountId} searchPlaceholder={t("Cari rekening…", "Search accounts…")} /> : null}
        <Field label={t("Jumlah pokok (Rp)", "Principal amount (Rp)")} value={amount} onChangeText={(v) => setAmount(v.trim())} keyboardType="decimal-pad" placeholder="0" hint={isAmount(amount) ? rp(amount) : undefined} />
        {debt ? <Btn label={t(`Lunasi ${rp(debt.remaining)}`, `Pay off ${rp(debt.remaining)}`)} kind="ghost" small onPress={() => setAmount(debt.remaining.replace(/\.0+$/, ""))} /> : null}
        <Field label={t("Bunga (Rp, opsional)", "Interest (Rp, optional)")} value={interest} onChangeText={(v) => setInterest(v.trim())} keyboardType="decimal-pad" placeholder="0"
          hint={payable ? t("Dicatat sebagai pengeluaran, tidak mengurangi pokok.", "Recorded as an expense; it does not reduce the principal.") : t("Dicatat sebagai pemasukan, tidak mengurangi pokok.", "Recorded as income; it does not reduce the principal.")} />
        {total !== null && total > 0 ? <T v="small" muted>{payable ? t("Total keluar dari rekening", "Total leaving the account") : t("Total masuk ke rekening", "Total entering the account")}: {rp(String(total))}</T> : null}
        <Field label={t("Catatan", "Note")} value={note} onChangeText={setNote} maxLength={200} />
        <Field label={t("Tanggal", "Date")} value={date} onChangeText={setDate} placeholder={t("TTTT-BB-HH", "YYYY-MM-DD")} autoCapitalize="none" autoCorrect={false} />
        <Btn label={t("Simpan", "Save")} onPress={submit} busy={busy} disabled={!debt || accounts.length === 0} />
      </Screen>
    </KeyboardAvoidingView>
  );
}
