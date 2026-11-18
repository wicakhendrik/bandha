import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, View } from "react-native";
import useSWR, { mutate } from "swr";
import {
  ApiError, EXPENSE_CATEGORIES, INCOME_CATEGORIES, QUICK_PCT, assetGroup, availableQty, decimalsOf, isAmount, isAmountOrZero, isDateKey, qty, rp,
  share, todayKey, type Account, type Asset, type CreateTransactionBody, type EditableTx, type Portfolio,
} from "@bandha/api-client";
import { client } from "../../src/api";
import { newIdempotencyKey } from "../../src/data";
import { useLang, useT } from "../../src/i18n";
import { AccountLogo, CoinLogo } from "../../src/logos";
import { SearchPicker, type PickerOption } from "../../src/picker";
import { useTheme, font } from "../../src/theme";
import { Banner, Btn, Field, Pill, Screen, Segmented, Skeleton, T } from "../../src/ui";

type Kind = "expense" | "income" | "transfer" | "buy" | "sell";
const KINDS: Kind[] = ["expense", "income", "transfer", "buy", "sell"];
/** "YYYY-MM-DD" of an instant in Asia/Jakarta. */
const jakartaDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

export default function AddTransaction() {
  const t = useT();
  const params = useLocalSearchParams<{ type?: string; edit?: string; account?: string }>();
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
  return <TransactionForm key={loaded.data?.transaction.id ?? "new"} edit={loaded.data?.transaction} initialAccountId={params.account} initialType={KINDS.includes(params.type as Kind) ? (params.type as Kind) : "expense"} />;
}

/** Quick-fill chips: a share of what is available (25%, 50%, 75%, all). */
function QuickShare({ available, decimals, onPick }: { available: string; decimals: number; onPick: (v: string) => void }) {
  const t = useT();
  if (!(Number(available) > 0)) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} accessibilityRole="toolbar" accessibilityLabel={t("Isi cepat dari saldo", "Quick fill from balance")}>
      {QUICK_PCT.map((p) => <Pill key={p} label={p === 100 ? t("Maks", "Max") : `${p}%`} onPress={() => onPick(share(available, p, decimals))} />)}
    </View>
  );
}

function TransactionForm({ edit, initialType, initialAccountId }: { edit?: EditableTx; initialType: Kind; /** Account to start on, e.g. the one whose screen is open. */ initialAccountId?: string }) {
  const c = useTheme();
  const t = useT();
  const { lang } = useLang();
  const accs = useSWR<{ accounts: Account[] }>("/accounts");
  const ast = useSWR<{ assets: Asset[] }>("/assets");
  const pf = useSWR<Portfolio>("/portfolio");
  const [type, setType] = useState<Kind | "opening">(edit?.type ?? initialType);
  const [accountId, setAccountId] = useState(edit?.accountId ?? edit?.fromAccountId ?? initialAccountId ?? "");
  const [toId, setToId] = useState(edit?.toAccountId ?? edit?.fundingAccountId ?? edit?.receivingAccountId ?? "");
  const [assetId, setAssetId] = useState(edit?.assetId ?? "");
  // The other side of a buy or sell: the asset it is paid with / received in. Empty = rupiah.
  const [otherId, setOtherId] = useState(edit?.payAssetId ?? edit?.receiveAssetId ?? "");
  const [otherQty, setOtherQty] = useState(edit?.payQuantity ?? edit?.receiveQuantity ?? "");
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
  const buy = type === "buy";
  const sell = type === "sell";
  const trade = buy || sell;
  const outflow = type === "expense" || type === "transfer";
  const accounts = accs.data?.accounts ?? [];
  const allAssets = ast.data?.assets ?? [];
  const held = pf.data?.positions ?? [];
  const idr = allAssets.find((a) => a.symbol === "IDR");

  /** What an account holds of an asset right now, plus (when editing) what the edited transaction itself had taken from it. */
  const available = (accountIdArg: string, assetIdArg: string) => availableQty(accounts, edit, idr?.id, accountIdArg, assetIdArg);
  /** Assets an account actually holds (quantity above zero). */
  const heldIn = (accountIdArg: string): Asset[] => allAssets.filter((a) => Number(available(accountIdArg, a.id)) > 0);

  // Selling: only accounts that hold something sellable (plus, when editing, the one being edited).
  const fromAccounts = sell ? accounts.filter((a) => a.id === edit?.accountId || held.some((p) => !p.cash && p.accounts.some((h) => h.accountId === a.id))) : accounts;
  const from = fromAccounts.some((a) => a.id === accountId) ? accountId : fromAccounts[0]?.id || "";

  // Which assets can be chosen for the main asset field.
  const assetPool: Asset[] = opening ? allAssets
    : outflow ? [...heldIn(from)].sort((a, b) => Number(b.symbol === "IDR") - Number(a.symbol === "IDR"))
    : sell ? allAssets.filter((a) => a.symbol !== "IDR" && Number(available(from, a.id)) > 0)
    : buy ? allAssets.filter((a) => a.symbol !== "IDR")
    : allAssets;
  const effAsset = opening ? (edit?.assetId ?? "")
    : assetPool.some((a) => a.id === assetId) ? assetId
    : ((trade || outflow) ? assetPool[0]?.id : idr?.id) ?? "";
  const asset = (opening ? allAssets : assetPool).find((a) => a.id === effAsset);

  const to = toId || (trade ? from : accounts.find((a) => a.id !== from)?.id || "");
  const toAccount = trade ? (accounts.some((a) => a.id === to) ? to : from) : to;

  // Other side of a trade. Buy: assets the paying account holds (rupiah included). Sell: any asset, rupiah first.
  const payPool: Asset[] = buy ? heldIn(toAccount).filter((a) => a.id !== effAsset)
    : sell ? [...allAssets.filter((a) => a.symbol === "IDR"), ...allAssets.filter((a) => a.symbol !== "IDR" && a.id !== effAsset)]
    : [];
  const effOther = !trade ? "" : (payPool.some((a) => a.id === otherId) ? otherId : (payPool.find((a) => a.symbol === "IDR") ?? payPool[0])?.id) ?? "";
  const other = payPool.find((a) => a.id === effOther);
  const otherIsIdr = !other || other.symbol === "IDR";

  const availMain = !opening && from && effAsset ? available(from, effAsset) : "0";
  const availPay = buy && toAccount && effOther ? available(toAccount, effOther) : "0";
  const needsFx = !trade && type !== "transfer" && !!asset && asset.symbol !== "IDR";
  const editedAccount = accounts.find((a) => a.id === edit?.accountId);

  // Rupiah estimate for the other side of an asset-for-asset trade, from today's price.
  const otherPrice = other && !otherIsIdr ? Number(other.price ?? 0) : 0;
  const estimate = otherPrice > 0 && isAmount(otherQty) ? String(Math.round(Number(otherQty) * otherPrice)) : "";
  // Rupiah-funded buy: offer quantity x today's price as the total (handy for shares and coins).
  const buyEstimate = buy && otherIsIdr && asset && Number(asset.price ?? 0) > 0 && isAmount(amount) ? String(Math.round(Number(amount) * Number(asset.price))) : "";
  const estimateValue = !otherIsIdr ? estimate : buyEstimate;
  const showEstimate = !!estimateValue && !total;

  const noHoldings = outflow && accounts.length > 0 && !!from && assetPool.length === 0;
  const nothingToSell = sell && !edit && pf.data !== undefined && assetPool.length === 0;

  async function submit() {
    setError("");
    if (!opening && !from) return setError(t("Tambahkan rekening dulu sebelum mencatat transaksi", "Add an account before recording a transaction"));
    if (!isAmount(amount)) return setError(t("Jumlah harus angka lebih dari 0, contoh 85000", "Amount must be a number above 0, e.g. 85000"));
    if (!opening && !effAsset) return setError(t("Rekening ini belum punya saldo aset yang bisa dipakai. Pilih rekening lain atau catat pemasukan dulu.", "This account has no asset balance to use. Pick another account or record some income first."));
    if ((outflow || sell) && Number(amount) > Number(availMain)) return setError(t(`Jumlah melebihi saldo tersedia (${qty(availMain)} ${asset?.symbol ?? ""})`, `Amount exceeds the available balance (${qty(availMain)} ${asset?.symbol ?? ""})`));
    if (needsFx && !isAmount(fx)) return setError(t("Isi nilai dalam rupiah untuk aset ini", "Enter the value in rupiah for this asset"));
    if (opening && asset && asset.symbol !== "IDR" && !isAmount(fx)) return setError(t("Isi nilai dalam rupiah untuk aset ini", "Enter the value in rupiah for this asset"));
    if (type === "transfer" && (!to || to === from)) return setError(t("Pilih dua rekening yang berbeda", "Choose two different accounts"));
    if (trade && !other) return setError(t("Rekening ini belum punya aset untuk membayar. Pilih rekening lain atau catat pemasukan dulu.", "This account has no asset to pay with. Pick another account or record some income first."));
    if (trade && !otherIsIdr && !isAmount(otherQty)) return setError(t(`Isi jumlah ${other?.symbol ?? ""} yang dipakai`, `Enter the amount of ${other?.symbol ?? ""} used`));
    if (trade && !isAmount(total)) return setError(!otherIsIdr ? t("Isi nilai dalam rupiah untuk aset ini", "Enter the value in rupiah for this asset") : buy ? t("Isi total biaya pembelian dalam rupiah", "Enter the total purchase cost in rupiah") : t("Isi total hasil penjualan dalam rupiah", "Enter the total sale proceeds in rupiah"));
    if (trade && fee && !isAmountOrZero(fee)) return setError(t("Biaya harus berupa angka", "Fee must be a number"));
    if (buy) {
      const need = otherIsIdr ? Number(total) + Number(fee || 0) : Number(otherQty) + Number(fee || 0);
      if (need > Number(availPay)) return setError(t(`Jumlah melebihi saldo tersedia (${qty(availPay)} ${other?.symbol ?? "IDR"})`, `Amount exceeds the available balance (${qty(availPay)} ${other?.symbol ?? "IDR"})`));
    }
    if (!isDateKey(date)) return setError(t("Tanggal harus berformat TTTT-BB-HH, contoh 2026-11-15", "Date must be YYYY-MM-DD, e.g. 2026-11-15"));
    setBusy(true);
    try {
      const meta = {
        ...(description.trim() ? { description: description.trim() } : {}),
        occurredAt: new Date(`${date}T12:00:00+07:00`).toISOString(),
      };
      const payField = otherIsIdr ? {} : buy ? { payAssetId: effOther, payQuantity: otherQty } : { receiveAssetId: effOther, receiveQuantity: otherQty };
      const feeField = fee ? { fee } : {};
      if (edit) {
        let body: Record<string, unknown>;
        if (type === "opening") body = { type, quantity: amount, ...(asset && asset.symbol !== "IDR" ? { functionalAmount: fx } : {}), ...meta };
        else if (buy) body = { type, accountId: from, fundingAccountId: toAccount || from, assetId: effAsset, quantity: amount, totalCost: total, ...payField, ...feeField, ...meta };
        else if (sell) body = { type, accountId: from, receivingAccountId: toAccount || from, assetId: effAsset, quantity: amount, proceeds: total, ...payField, ...feeField, ...meta };
        else if (type === "transfer") body = { type, fromAccountId: from, toAccountId: to, assetId: effAsset, quantity: amount, ...meta };
        else body = { type, accountId: from, assetId: effAsset, quantity: amount, ...(needsFx ? { functionalAmount: fx } : {}), ...(category.trim() ? { category: category.trim() } : {}), ...meta };
        await client.replaceTransaction(edit.id, body);
      } else {
        const common = { assetId: effAsset, quantity: amount, ...meta, idempotencyKey: key.current };
        let body: CreateTransactionBody;
        if (buy) body = { type, accountId: from, fundingAccountId: toAccount || from, totalCost: total, ...payField, ...feeField, ...common };
        else if (sell) body = { type, accountId: from, receivingAccountId: toAccount || from, proceeds: total, ...payField, ...feeField, ...common };
        else if (type === "transfer") body = { type, fromAccountId: from, toAccountId: to, ...common };
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
  const groupName = (a: Asset) => ({
    fiat: t("Mata uang", "Currencies"), gold: t("Emas", "Gold"), stockId: t("Saham Indonesia", "Indonesian stocks"), stockUs: t("Saham AS", "US stocks"),
    mainCoins: t("Koin utama", "Main coins"), otherCoins: t("Koin lain", "Other coins"),
  })[assetGroup(a)];
  const assetOption = (a: Asset, holder?: string): PickerOption => {
    const have = holder ? available(holder, a.id) : "0";
    return {
      value: a.id, label: a.symbol, icon: <CoinLogo symbol={a.symbol} size={30} />, keywords: a.name, group: groupName(a),
      hint: Number(have) > 0 ? t(`Tersedia ${qty(have)}`, `Available ${qty(have)}`) : a.name,
    };
  };
  const assetOptions = assetPool.map((a) => assetOption(a, outflow || sell ? from : undefined));
  const otherOptions = payPool.map((a) => assetOption(a, buy ? toAccount : undefined));

  const categories = type === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  const unit = trade && isAmount(amount) && isAmount(total) ? rp(String(Number(total) / Number(amount))) : null;
  const typeLabel = { expense: t("Keluar", "Expense"), income: t("Masuk", "Income"), transfer: "Transfer", buy: t("Beli", "Buy"), sell: t("Jual", "Sell"), opening: t("Saldo awal", "Opening balance") }[type];
  const resetFor = (k: Kind) => { setType(k); setError(""); setAssetId(""); setOtherId(""); setOtherQty(""); setAmount(""); setTotal(""); setFee(""); };
  const searchAssets = t("Cari aset…", "Search assets…");
  const searchAccounts = t("Cari rekening…", "Search accounts…");

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
          <Segmented<Kind> value={type as Kind} onChange={resetFor} options={[
            { key: "expense", label: t("Keluar", "Expense") }, { key: "income", label: t("Masuk", "Income") }, { key: "transfer", label: "Transfer" }, { key: "buy", label: t("Beli", "Buy") }, { key: "sell", label: t("Jual", "Sell") },
          ]} />
        )}
        {error ? <Banner tone="err">{error}</Banner> : null}
        {accs.data && accounts.length === 0 ? <Banner tone="warn">{t("Belum ada rekening. Tambahkan rekening terlebih dulu di tab Rekening.", "No accounts yet. Add an account first in the Accounts tab.")}</Banner> : null}
        {nothingToSell ? <Banner tone="warn">{t("Belum ada aset yang bisa dijual. Catat pembelian terlebih dulu.", "Nothing to sell yet. Record a purchase first.")}</Banner> : null}
        {noHoldings ? <Banner tone="warn">{t("Rekening ini belum punya saldo aset yang bisa dipakai. Pilih rekening lain atau catat pemasukan dulu.", "This account has no asset balance to use. Pick another account or record some income first.")}</Banner> : null}

        {opening ? (
          <View style={{ gap: 4 }}>
            <T v="label" muted>{t("Rekening", "Account")}</T>
            <T>{editedAccount?.name ?? "…"} · {asset?.symbol}</T>
            <T v="small" muted>{t("Rekening dan aset saldo awal tidak bisa diubah.", "The account and asset of an opening balance cannot be changed.")}</T>
          </View>
        ) : (
          <>
            {fromOptions.length > 0 && <SearchPicker label={type === "transfer" ? t("Dari rekening", "From account") : trade ? t("Rekening aset", "Asset account") : t("Rekening", "Account")} options={fromOptions} value={from} onChange={(v) => { setAccountId(v); setAmount(""); }} searchPlaceholder={searchAccounts} />}
            {type === "transfer" && accOptions.length > 1 && <SearchPicker label={t("Ke rekening", "To account")} options={accOptions.filter((o) => o.value !== from)} value={to} onChange={setToId} searchPlaceholder={searchAccounts} />}
            {trade && accOptions.length > 0 && <SearchPicker label={buy ? t("Dibayar dari rekening", "Paid from account") : t("Hasil masuk ke rekening", "Proceeds go to account")} options={accOptions} value={toAccount} onChange={(v) => { setToId(v); setOtherId(""); setOtherQty(""); }} searchPlaceholder={searchAccounts} />}
            {assetOptions.length > 0 && <SearchPicker label={buy ? t("Aset yang dibeli", "Asset to buy") : t("Aset", "Asset")} options={assetOptions} value={effAsset} onChange={(v) => { setAssetId(v); setAmount(""); }} searchPlaceholder={searchAssets} />}
          </>
        )}

        <View style={{ gap: 8 }}>
          <Field label={t("Jumlah", "Amount")} value={amount} onChangeText={(v) => setAmount(v.trim())} keyboardType="decimal-pad" placeholder="0"
            hint={!trade && !needsFx && !(opening && asset?.symbol !== "IDR") && type !== "transfer" && isAmount(amount) ? rp(amount) : undefined} />
          {(outflow || sell) && effAsset ? (
            <>
              <T v="small" muted>{t(`Tersedia: ${qty(availMain)} ${asset?.symbol ?? ""}`, `Available: ${qty(availMain)} ${asset?.symbol ?? ""}`)}</T>
              <QuickShare available={availMain} decimals={decimalsOf(asset)} onPick={setAmount} />
            </>
          ) : null}
        </View>

        {trade && (
          <>
            <View style={{ gap: 6 }}>
              {payPool.length > 0 ? (
                <SearchPicker label={buy ? t("Bayar dengan", "Pay with") : t("Terima dalam", "Receive as")} options={otherOptions} value={effOther} onChange={(v) => { setOtherId(v); setOtherQty(""); setTotal(""); }} searchPlaceholder={searchAssets} />
              ) : <T v="small" muted>{t("Rekening ini belum punya aset untuk membayar. Pilih rekening lain atau catat pemasukan dulu.", "This account has no asset to pay with. Pick another account or record some income first.")}</T>}
              {buy && other ? <T v="small" muted>{t(`Tersedia: ${qty(availPay)} ${other.symbol}`, `Available: ${qty(availPay)} ${other.symbol}`)}</T> : null}
            </View>

            {!otherIsIdr && (
              <View style={{ gap: 8 }}>
                <Field label={buy ? t(`Jumlah dibayar (${other?.symbol ?? ""})`, `Amount paid (${other?.symbol ?? ""})`) : t(`Jumlah diterima (${other?.symbol ?? ""})`, `Amount received (${other?.symbol ?? ""})`)} value={otherQty} onChangeText={(v) => setOtherQty(v.trim())} keyboardType="decimal-pad" placeholder="0" />
                {buy ? <QuickShare available={availPay} decimals={decimalsOf(other)} onPick={setOtherQty} /> : null}
              </View>
            )}

            <View style={{ gap: 6 }}>
              <Field label={!otherIsIdr ? t("Nilai dalam rupiah", "Value in rupiah") : buy ? t("Total biaya pembelian (Rp)", "Total purchase cost (Rp)") : t("Total hasil penjualan (Rp)", "Total sale proceeds (Rp)")}
                value={total} onChangeText={(v) => setTotal(v.trim())} keyboardType="decimal-pad" placeholder={showEstimate ? estimateValue : "0"}
                hint={`${isAmount(total) ? rp(total) : t("Tanpa biaya transaksi.", "Excluding transaction fee.")}${unit ? ` · ${t(`harga rata-rata ${unit} per unit`, `average price ${unit} per unit`)}` : ""}`} />
              {showEstimate ? (
                <Pressable onPress={() => setTotal(estimateValue)} accessibilityRole="button" hitSlop={8}>
                  <T v="small" color={c.gold} style={{ fontFamily: font.sansSemi }}>{t(`Pakai perkiraan ${rp(estimateValue)} (harga pasar)`, `Use the estimate ${rp(estimateValue)} (market price)`)}</T>
                </Pressable>
              ) : null}
            </View>

            <Field label={otherIsIdr ? t("Biaya transaksi (Rp, opsional)", "Transaction fee (Rp, optional)") : t(`Biaya transaksi (${other?.symbol ?? ""}, opsional)`, `Transaction fee (${other?.symbol ?? ""}, optional)`)}
              value={fee} onChangeText={(v) => setFee(v.trim())} keyboardType="decimal-pad" placeholder="0" hint={t("Dicatat sebagai pengeluaran terpisah, tidak masuk modal.", "Recorded as a separate expense, not part of the cost.")} />
          </>
        )}
        {(needsFx || (opening && asset && asset.symbol !== "IDR")) && <Field label={t("Nilai dalam rupiah", "Value in rupiah")} value={fx} onChangeText={(v) => setFx(v.trim())} keyboardType="decimal-pad" placeholder={t("Total nilai dalam IDR", "Total value in IDR")} hint={isAmount(fx) ? rp(fx) : undefined} />}
        {(type === "income" || type === "expense") && (
          <View style={{ gap: 8 }}>
            <T v="label" muted>{t("Kategori", "Category")}</T>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} accessibilityRole="toolbar" accessibilityLabel={t("Pilih kategori cepat", "Quick categories")}>
              {categories.map((cat) => (
                <Pill key={cat.id} on={category === cat.id} label={`${cat.icon} ${lang === "en" ? cat.en : cat.id}`} accessibilityLabel={lang === "en" ? cat.en : cat.id} onPress={() => setCategory(category === cat.id ? "" : cat.id)} />
              ))}
            </View>
            <Field label={t("Kategori sendiri", "Your own category")} value={category} onChangeText={setCategory} placeholder={t("mis. Makan, Gaji", "e.g. Food, Salary")} maxLength={60} />
          </View>
        )}
        <Field label={t("Catatan", "Note")} value={description} onChangeText={setDescription} maxLength={200} />
        <Field label={t("Tanggal", "Date")} value={date} onChangeText={setDate} placeholder={t("TTTT-BB-HH", "YYYY-MM-DD")} autoCapitalize="none" autoCorrect={false} />
        <Btn label={t("Simpan", "Save")} onPress={submit} busy={busy} disabled={accounts.length === 0 || (sell && assetPool.length === 0) || noHoldings} />
      </Screen>
    </KeyboardAvoidingView>
  );
}
