import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import useSWR, { mutate } from "swr";
import {
  ApiError, PRIORITY_COINS, isAmount, isAmountOrZero, isDateKey, rp, todayKey,
  qty, type Account, type Asset, type CreateTransactionBody, type EditableTx, type Portfolio,
} from "@bandha/api-client";
import { client } from "../../src/api";
import { newIdempotencyKey } from "../../src/data";
import { useT } from "../../src/i18n";
import { AccountLogo, CoinLogo } from "../../src/logos";
import { SearchPicker, type PickerOption } from "../../src/picker";
import { Banner, Btn, Field, Screen, Segmented, Skeleton, T } from "../../src/ui";

type Kind = "expense" | "income" | "transfer" | "buy" | "sell";
const KINDS: Kind[] = ["expense", "income", "transfer", "buy", "sell"];
/** "YYYY-MM-DD" of an instant in Asia/Jakarta. */
const jakartaDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

export default function AddTransaction() {
  const t = useT();
  const params = useLocalSearchParams<{ type?: string; edit?: string }>();
  const loaded = useSWR<{ transaction: EditableTx }>(params.edit ? `/transactions/${params.edit}` : null, { revalidateOnFocus: false, shouldRetryOnError: false });

  if (params.edit && !loaded.data) {
    return (
      <Screen>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <T v="title" accessibilityRole="header">{t("Edit transaksi", "Edit transaction")}</T>
          <Btn label={t("Tutup", "Close")} kind="ghost" small onPress={() => router.back()} />
        </View>
        {loaded.error ? <Banner tone="err">{t("Transaksi tidak bisa dimuat untuk diedit.", "This transaction could not be loaded for editing.")}</Banner> : <Skeleton h={200} />}
      </Screen>
    );
  }
  return <TransactionForm edit={loaded.data?.transaction} initialType={KINDS.includes(params.type as Kind) ? (params.type as Kind) : "expense"} />;
}

function TransactionForm({ edit, initialType }: { edit?: EditableTx; initialType: Kind }) {
  const t = useT();
  const accs = useSWR<{ accounts: Account[] }>("/accounts");
  const ast = useSWR<{ assets: Asset[] }>("/assets");
  const pf = useSWR<Portfolio>("/portfolio");
  const [type, setType] = useState<Kind | "opening">(edit?.type ?? initialType);
  const [accountId, setAccountId] = useState(edit?.accountId ?? edit?.fromAccountId ?? "");
  const [toId, setToId] = useState(edit?.toAccountId ?? edit?.fundingAccountId ?? edit?.receivingAccountId ?? "");
  const [assetId, setAssetId] = useState(edit?.assetId ?? "");
  const [amount, setAmount] = useState(edit?.quantity ?? "");
  const [fx, setFx] = useState(edit?.functionalAmount ?? "");
  const [total, setTotal] = useState(edit?.totalCost ?? edit?.proceeds ?? "");
  const [fee, setFee] = useState(edit?.fee ?? "");
  const [category, setCategory] = useState(edit?.category ?? "");
  const [description, setDescription] = useState(edit?.description ?? "");
  const [date, setDate] = useState(edit ? jakartaDay(edit.occurredAt) : todayKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef(newIdempotencyKey());

  const opening = type === "opening";
  const trade = type === "buy" || type === "sell";
  const sell = type === "sell";
  const accounts = accs.data?.accounts ?? [];
  const all = ast.data?.assets ?? [];
  const held = pf.data?.positions ?? [];
  const idr = all.find((a) => a.symbol === "IDR");
  // Trades are always against IDR; selling only offers assets that are actually held (plus, when editing, the one being sold).
  const assets = all.filter((a) => !trade || a.symbol !== "IDR").filter((a) => !sell || a.id === edit?.assetId || held.some((p) => p.assetId === a.id));
  const effAsset = opening ? (edit?.assetId ?? "") : assets.some((a) => a.id === assetId) ? assetId : ((trade ? assets[0]?.id : idr?.id) ?? "");
  const asset = (opening ? all : assets).find((a) => a.id === effAsset);
  const holders = sell ? (held.find((p) => p.assetId === effAsset)?.accounts ?? []) : [];
  const fromAccounts = sell ? accounts.filter((a) => a.id === edit?.accountId || holders.some((h) => h.accountId === a.id)) : accounts;
  const from = fromAccounts.some((a) => a.id === accountId) ? accountId : fromAccounts[0]?.id || "";
  const to = toId || (trade ? from : accounts.find((a) => a.id !== from)?.id || "");
  // Selling: what the account holds now, plus the quantity of the sale being edited (it is put back first).
  const heldNow = holders.find((h) => h.accountId === from)?.quantity;
  const backIn = edit?.type === "sell" && edit.accountId === from && edit.assetId === effAsset ? Number(edit.quantity) : 0;
  const heldHere = heldNow !== undefined || backIn ? String(Number((Number(heldNow ?? 0) + backIn).toFixed(12))) : undefined;
  const needsFx = !trade && !!asset && asset.symbol !== "IDR";
  const editedAccount = accounts.find((a) => a.id === edit?.accountId);

  async function submit() {
    setError("");
    if (!opening && !from) return setError(t("Tambahkan rekening dulu sebelum mencatat transaksi", "Add an account before recording a transaction"));
    if (!isAmount(amount)) return setError(t("Jumlah harus angka lebih dari 0, contoh 85000", "Amount must be a number above 0, e.g. 85000"));
    if (needsFx && !isAmount(fx)) return setError(t("Isi nilai dalam rupiah untuk aset ini", "Enter the value in rupiah for this asset"));
    if (opening && asset && asset.symbol !== "IDR" && !isAmount(fx)) return setError(t("Isi nilai dalam rupiah untuk aset ini", "Enter the value in rupiah for this asset"));
    if (type === "transfer" && (!to || to === from)) return setError(t("Pilih dua rekening yang berbeda", "Choose two different accounts"));
    if (trade && !isAmount(total)) return setError(type === "buy" ? t("Isi total biaya pembelian dalam rupiah", "Enter the total purchase cost in rupiah") : t("Isi total hasil penjualan dalam rupiah", "Enter the total sale proceeds in rupiah"));
    if (trade && fee && !isAmountOrZero(fee)) return setError(t("Biaya harus berupa angka", "Fee must be a number"));
    if (!isDateKey(date)) return setError(t("Tanggal harus berformat TTTT-BB-HH, contoh 2026-11-15", "Date must be YYYY-MM-DD, e.g. 2026-11-15"));
    setBusy(true);
    try {
      const meta = {
        ...(description.trim() ? { description: description.trim() } : {}),
        occurredAt: new Date(`${date}T12:00:00+07:00`).toISOString(),
      };
      if (edit) {
        let body: Record<string, unknown>;
        if (type === "opening") body = { type, quantity: amount, ...(asset && asset.symbol !== "IDR" ? { functionalAmount: fx } : {}), ...meta };
        else if (type === "buy") body = { type, accountId: from, fundingAccountId: to || from, assetId: effAsset, quantity: amount, totalCost: total, ...(fee ? { fee } : {}), ...meta };
        else if (type === "sell") body = { type, accountId: from, receivingAccountId: to || from, assetId: effAsset, quantity: amount, proceeds: total, ...(fee ? { fee } : {}), ...meta };
        else if (type === "transfer") body = { type, fromAccountId: from, toAccountId: to, assetId: effAsset, quantity: amount, ...(needsFx ? { functionalAmount: fx } : {}), ...meta };
        else body = { type, accountId: from, assetId: effAsset, quantity: amount, ...(needsFx ? { functionalAmount: fx } : {}), ...(category.trim() ? { category: category.trim() } : {}), ...meta };
        await client.replaceTransaction(edit.id, body);
      } else {
        const common = { assetId: effAsset, quantity: amount, ...meta, idempotencyKey: key.current };
        let body: CreateTransactionBody;
        if (type === "buy") body = { type, accountId: from, fundingAccountId: to || from, totalCost: total, ...(fee ? { fee } : {}), ...common };
        else if (type === "sell") body = { type, accountId: from, receivingAccountId: to || from, proceeds: total, ...(fee ? { fee } : {}), ...common };
        else if (type === "transfer") body = { type, fromAccountId: from, toAccountId: to, ...(needsFx ? { functionalAmount: fx } : {}), ...common };
        else if (type === "income" || type === "expense") body = { type, accountId: from, ...(needsFx ? { functionalAmount: fx } : {}), ...(category.trim() ? { category: category.trim() } : {}), ...common };
        else return;
        await client.createTransaction(body);
      }
      await mutate(() => true);
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? (e.issues?.[0] ? `${e.issues[0].path}: ${e.issues[0].message}` : e.message) : t("Terjadi kesalahan", "Something went wrong"));
      setBusy(false);
    }
  }

  const toOption = (a: Account): PickerOption => ({ value: a.id, label: a.name, icon: <AccountLogo account={a} size={30} />, keywords: a.kind });
  const accOptions = accounts.map(toOption);
  const fromOptions = fromAccounts.map(toOption);
  const assetOptions: PickerOption[] = assets.map((a) => ({
    value: a.id, label: a.symbol, hint: a.name, icon: <CoinLogo symbol={a.symbol} size={30} />, keywords: a.name,
    group: a.kind === "fiat" ? t("Mata uang", "Currencies") : a.kind === "gold" ? t("Emas", "Gold") : PRIORITY_COINS.includes(a.symbol) ? t("Koin utama", "Main coins") : t("Koin lain", "Other coins"),
  }));
  const unit = trade && isAmount(amount) && isAmount(total) ? rp(String(Number(total) / Number(amount))) : null;
  const typeLabel = { expense: t("Keluar", "Expense"), income: t("Masuk", "Income"), transfer: "Transfer", buy: t("Beli", "Buy"), sell: t("Jual", "Sell"), opening: t("Saldo awal", "Opening balance") }[type];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <T v="title" accessibilityRole="header">{edit ? t("Edit transaksi", "Edit transaction") : t("Catat transaksi", "Add transaction")}</T>
          <Btn label={t("Tutup", "Close")} kind="ghost" small onPress={() => router.back()} />
        </View>
        {edit ? (
          <T v="small" muted>{typeLabel}: {t("jenis transaksi tidak bisa diubah. Untuk mengganti jenis, batalkan lalu catat ulang.", "the type cannot be changed. To change it, void the transaction and record it again.")}</T>
        ) : (
          <Segmented<Kind> value={type as Kind} onChange={(k) => { setType(k); setError(""); }} options={[
            { key: "expense", label: t("Keluar", "Expense") }, { key: "income", label: t("Masuk", "Income") }, { key: "transfer", label: "Transfer" }, { key: "buy", label: t("Beli", "Buy") }, { key: "sell", label: t("Jual", "Sell") },
          ]} />
        )}
        {error ? <Banner tone="err">{error}</Banner> : null}
        {accs.data && accounts.length === 0 ? <Banner tone="warn">{t("Belum ada rekening. Tambahkan rekening terlebih dulu di tab Rekening.", "No accounts yet. Add an account first in the Accounts tab.")}</Banner> : null}

        {sell && pf.data && held.length === 0 && !edit ? <Banner tone="warn">{t("Belum ada aset yang bisa dijual. Catat pembelian terlebih dulu.", "Nothing to sell yet. Record a purchase first.")}</Banner> : null}
        {opening ? (
          <View style={{ gap: 4 }}>
            <T v="label" muted>{t("Rekening", "Account")}</T>
            <T>{editedAccount?.name ?? "…"} · {asset?.symbol}</T>
            <T v="small" muted>{t("Rekening dan aset saldo awal tidak bisa diubah.", "The account and asset of an opening balance cannot be changed.")}</T>
          </View>
        ) : (
          <>
            {fromOptions.length > 0 && <SearchPicker label={type === "transfer" ? t("Dari rekening", "From account") : trade ? t("Rekening aset", "Asset account") : t("Rekening", "Account")} options={fromOptions} value={from} onChange={setAccountId} searchPlaceholder={t("Cari rekening…", "Search accounts…")} />}
            {type === "transfer" && accOptions.length > 1 && <SearchPicker label={t("Ke rekening", "To account")} options={accOptions.filter((o) => o.value !== from)} value={to} onChange={setToId} searchPlaceholder={t("Cari rekening…", "Search accounts…")} />}
            {trade && accOptions.length > 0 && <SearchPicker label={type === "buy" ? t("Dibayar dari rekening", "Paid from account") : t("Hasil masuk ke rekening", "Proceeds go to account")} options={accOptions} value={to || from} onChange={setToId} searchPlaceholder={t("Cari rekening…", "Search accounts…")} />}
            {assets.length > 0 && <SearchPicker label={t("Aset", "Asset")} options={assetOptions} value={effAsset} onChange={setAssetId} searchPlaceholder={t("Cari aset…", "Search assets…")} />}
          </>
        )}

        <Field label={t("Jumlah", "Amount")} value={amount} onChangeText={(v) => setAmount(v.trim())} keyboardType="decimal-pad" placeholder="0" hint={sell && heldHere ? t(`Dimiliki di rekening ini: ${qty(heldHere)} ${asset?.symbol ?? ""}`, `Held in this account: ${qty(heldHere)} ${asset?.symbol ?? ""}`) : !trade && !needsFx && !(opening && asset?.symbol !== "IDR") && isAmount(amount) ? rp(amount) : undefined} />
        {trade && (
          <>
            <Field label={type === "buy" ? t("Total biaya pembelian (Rp)", "Total purchase cost (Rp)") : t("Total hasil penjualan (Rp)", "Total sale proceeds (Rp)")} value={total} onChangeText={(v) => setTotal(v.trim())} keyboardType="decimal-pad" placeholder="0"
              hint={isAmount(total) ? `${rp(total)}${unit ? ` · ${t(`rata-rata ${unit} per unit`, `average ${unit} per unit`)}` : ""}` : undefined} />
            <Field label={t("Biaya transaksi (Rp, opsional)", "Transaction fee (Rp, optional)")} value={fee} onChangeText={(v) => setFee(v.trim())} keyboardType="decimal-pad" placeholder="0" hint={t("Dicatat sebagai pengeluaran terpisah, tidak masuk modal.", "Recorded as a separate expense, not part of the cost.")} />
          </>
        )}
        {(needsFx || (opening && asset && asset.symbol !== "IDR")) && <Field label={t("Nilai dalam rupiah", "Value in rupiah")} value={fx} onChangeText={(v) => setFx(v.trim())} keyboardType="decimal-pad" placeholder={t("Total nilai dalam IDR", "Total value in IDR")} hint={isAmount(fx) ? rp(fx) : undefined} />}
        {(type === "income" || type === "expense") && <Field label={t("Kategori", "Category")} value={category} onChangeText={setCategory} placeholder={t("mis. Makan, Gaji", "e.g. Food, Salary")} maxLength={60} />}
        <Field label={t("Catatan", "Note")} value={description} onChangeText={setDescription} maxLength={200} />
        <Field label={t("Tanggal", "Date")} value={date} onChangeText={setDate} placeholder={t("TTTT-BB-HH", "YYYY-MM-DD")} autoCapitalize="none" autoCorrect={false} />
        <Btn label={t("Simpan", "Save")} onPress={submit} busy={busy} disabled={accounts.length === 0 || (sell && assets.length === 0)} />
      </Screen>
    </KeyboardAvoidingView>
  );
}
