import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import useSWR, { mutate } from "swr";
import {
  ApiError, DEBT_KINDS, debtKindLabel, isAmount, isDateKey, rp, todayKey,
  type Account, type DebtDetail, type DebtDirection, type DebtKind,
} from "@bandha/api-client";
import { client } from "../../src/api";
import { newIdempotencyKey } from "../../src/data";
import { useT } from "../../src/i18n";
import { AccountLogo } from "../../src/logos";
import { SearchPicker, type PickerOption } from "../../src/picker";
import { Banner, Btn, Field, Screen, Segmented, T } from "../../src/ui";

const NO_ACCOUNT = "none";

/** Creates a debt / receivable, or (with ?id=) edits the descriptive fields of an existing one. */
export default function AddDebt() {
  const t = useT();
  const { id, direction: dirParam } = useLocalSearchParams<{ id?: string; direction?: string }>();
  const editing = !!id;
  const accs = useSWR<{ accounts: Account[] }>("/accounts");
  const existing = useSWR<DebtDetail>(id ? `/debts/${id}` : null);
  const accounts = accs.data?.accounts ?? [];

  const [direction, setDirection] = useState<DebtDirection>(dirParam === "receivable" ? "receivable" : "payable");
  const [who, setWho] = useState<string | null>(null);
  const [kind, setKind] = useState<DebtKind | null>(null);
  const [principal, setPrincipal] = useState("");
  const [accountId, setAccountId] = useState("");
  const [due, setDue] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [date, setDate] = useState(todayKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef(newIdempotencyKey());

  const d = existing.data?.debt;
  const dir = editing ? (d?.direction ?? "payable") : direction;
  const payable = dir === "payable";
  const whoV = who ?? d?.counterparty ?? "";
  const kindV = (kind ?? d?.kind ?? "personal") as DebtKind;
  const dueV = due ?? d?.dueDate ?? "";
  const noteV = note ?? d?.note ?? "";
  const effAccount = accountId === NO_ACCOUNT ? NO_ACCOUNT : accounts.some((a) => a.id === accountId) ? accountId : (accounts[0]?.id ?? NO_ACCOUNT);

  const accountOptions: PickerOption[] = [
    ...accounts.map((a) => ({ value: a.id, label: a.name, icon: <AccountLogo account={a} size={30} />, keywords: a.kind })),
    { value: NO_ACCOUNT, label: t("Sudah ada sebelumnya (tidak lewat rekening)", "Already existing (not through an account)") },
  ];
  const kindOptions: PickerOption[] = DEBT_KINDS.map((k) => ({ value: k, label: debtKindLabel(k) }));

  async function submit() {
    setError("");
    if (!whoV.trim()) return setError(t("Isi nama pihak terkait", "Enter who this is with"));
    if (dueV && !isDateKey(dueV)) return setError(t("Jatuh tempo harus berformat TTTT-BB-HH, contoh 2027-01-31", "Due date must be YYYY-MM-DD, e.g. 2027-01-31"));
    if (!editing) {
      if (!isAmount(principal)) return setError(t("Jumlah harus angka lebih dari 0, contoh 5000000", "Amount must be a number above 0, e.g. 5000000"));
      if (!isDateKey(date)) return setError(t("Tanggal harus berformat TTTT-BB-HH", "Date must be YYYY-MM-DD"));
    }
    setBusy(true);
    try {
      if (editing && id) {
        await client.updateDebt(id, { counterparty: whoV.trim(), kind: kindV, dueDate: dueV || null, note: noteV.trim() || null });
      } else {
        await client.createDebt({
          direction: dir, kind: kindV, counterparty: whoV.trim(), principal,
          ...(effAccount !== NO_ACCOUNT ? { accountId: effAccount } : {}),
          ...(dueV ? { dueDate: dueV } : {}),
          ...(noteV.trim() ? { note: noteV.trim() } : {}),
          occurredAt: new Date(`${date}T12:00:00+07:00`).toISOString(),
          idempotencyKey: key.current,
        });
      }
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
          <T v="title" accessibilityRole="header">{editing ? t("Edit utang / piutang", "Edit debt / receivable") : t("Tambah utang / piutang", "Add debt / receivable")}</T>
          <Btn label={t("Tutup", "Close")} kind="ghost" small onPress={() => router.back()} />
        </View>
        {!editing ? (
          <Segmented<DebtDirection> value={direction} onChange={(k) => { setDirection(k); setError(""); }}
            options={[{ key: "payable", label: t("Saya berutang", "I borrowed") }, { key: "receivable", label: t("Saya meminjamkan", "I lent") }]} />
        ) : null}
        {error ? <Banner tone="err">{error}</Banner> : null}

        <Field label={payable ? t("Dipinjam dari", "Borrowed from") : t("Dipinjamkan ke", "Lent to")} value={whoV} onChangeText={setWho} placeholder={t("Nama orang atau lembaga", "Person or institution name")} maxLength={80} />
        <SearchPicker label={t("Jenis", "Type")} options={kindOptions} value={kindV} onChange={(v) => setKind(v as DebtKind)} searchPlaceholder={t("Cari jenis…", "Search types…")} />
        {!editing ? (
          <>
            <Field label={t("Jumlah pokok (Rp)", "Principal amount (Rp)")} value={principal} onChangeText={(v) => setPrincipal(v.trim())} keyboardType="decimal-pad" placeholder="0" hint={isAmount(principal) ? rp(principal) : undefined} />
            <SearchPicker label={payable ? t("Uang pinjaman masuk ke rekening", "Loan money goes into account") : t("Uang keluar dari rekening", "Money leaves from account")} options={accountOptions} value={effAccount} onChange={setAccountId} searchPlaceholder={t("Cari rekening…", "Search accounts…")} />
            {effAccount === NO_ACCOUNT ? <T v="small" muted>{t("Dicatat sebagai kewajiban atau tagihan yang sudah ada; saldo rekening tidak berubah.", "Recorded as an existing obligation or claim; no account balance changes.")}</T> : null}
          </>
        ) : null}
        <Field label={t("Jatuh tempo (opsional)", "Due date (optional)")} value={dueV} onChangeText={setDue} placeholder={t("TTTT-BB-HH", "YYYY-MM-DD")} autoCapitalize="none" autoCorrect={false} />
        <Field label={t("Catatan", "Note")} value={noteV} onChangeText={setNote} maxLength={200} />
        {!editing ? <Field label={t("Tanggal", "Date")} value={date} onChangeText={setDate} placeholder={t("TTTT-BB-HH", "YYYY-MM-DD")} autoCapitalize="none" autoCorrect={false} /> : null}
        <Btn label={t("Simpan", "Save")} onPress={submit} busy={busy} disabled={editing && !d} />
      </Screen>
    </KeyboardAvoidingView>
  );
}
