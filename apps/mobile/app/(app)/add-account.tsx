import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Switch, View } from "react-native";
import useSWR, { mutate } from "swr";
import {
  ApiError, ASSET_CLASS_OF_CATEGORY, BRANDS, GENERIC_BRAND_OF_KIND, KIND_OF_CATEGORY, PRIORITY_COINS, brandByKey, categoryLabel, guessBrand, isAmountOrZero, qty, rp,
  type Account, type Asset, type AssetClass, type CoinChoice,
} from "@bandha/api-client";
import { client } from "../../src/api";
import { useT } from "../../src/i18n";
import { BrandLogo, CoinLogo } from "../../src/logos";
import { SearchPicker, type PickerOption } from "../../src/picker";
import { useTheme } from "../../src/theme";
import { Banner, Btn, Field, Screen, T } from "../../src/ui";

/** The Jenis (brand) an existing account maps to: its saved brand, else a guess from its name, else a generic one for its kind. */
const brandKeyOf = (a: Account): string => brandByKey(a.brandKey)?.key ?? guessBrand(a.name)?.key ?? GENERIC_BRAND_OF_KIND[a.kind] ?? "bank-lainnya";

/** Rupiah per unit x quantity, or null when either side is unknown. */
const estimate = (price: string | null | undefined, quantity: string): string | null =>
  price && isAmountOrZero(quantity) && Number(quantity) > 0 ? String(Math.round(Number(price) * Number(quantity))) : null;

export default function AccountForm() {
  const c = useTheme();
  const t = useT();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const accounts = useSWR<{ accounts: Account[] }>("/accounts");
  const existing = id ? accounts.data?.accounts.find((a) => a.id === id) : undefined;
  const editing = !!id;

  const [brandKey, setBrandKey] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [includeNet, setIncludeNet] = useState(true);
  const [assetId, setAssetId] = useState("");
  const [picked, setPicked] = useState<Asset | null>(null);
  const [coinQuery, setCoinQuery] = useState("");
  const [amount, setAmount] = useState("");
  const [fx, setFx] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Prefill once when editing, as soon as the account has loaded.
  if (existing && loadedFor !== existing.id) {
    setLoadedFor(existing.id);
    setBrandKey(brandKeyOf(existing));
    setName(existing.name);
    setIncludeNet(existing.includeInNetWorth);
  }

  const brand = brandByKey(brandKey);
  const category = brand?.category;
  const assetClass: AssetClass | null = category ? ASSET_CLASS_OF_CATEGORY[category] : null;

  const catalog = useSWR<{ assets: Asset[] }>(!editing && assetClass ? `/assets?kind=${assetClass}` : null);
  const coinSearch = useSWR<{ coins: CoinChoice[]; remote: boolean }>(
    !editing && assetClass === "crypto" && coinQuery.length >= 2 ? `/assets/crypto/search?q=${encodeURIComponent(coinQuery)}` : null,
  );

  const brandOptions: PickerOption[] = useMemo(
    () => BRANDS.map((b) => ({
      value: b.key, label: b.name, group: categoryLabel(b.category), icon: <BrandLogo brand={b} size={32} />, keywords: `${b.aliases.join(" ")} ${categoryLabel(b.category)}`,
    })),
    [t], // categoryLabel follows the language
  );

  const assetOption = (a: Asset, group?: string): PickerOption => ({
    value: a.id, label: a.symbol, hint: a.name, icon: <CoinLogo symbol={a.symbol} size={30} />, keywords: a.name, ...(group ? { group } : {}),
  });

  const assetOptions: PickerOption[] = useMemo(() => {
    const list = catalog.data?.assets ?? [];
    let opts: PickerOption[];
    if (assetClass === "crypto" && coinQuery.length >= 2 && coinSearch.data) {
      opts = coinSearch.data.coins.map((co) => ({
        value: co.assetId ?? `cg:${co.coingeckoId}`, label: co.symbol, hint: co.assetId ? co.name : `${co.name} · ${t("Baru", "New")}`,
        icon: <CoinLogo symbol={co.symbol} size={30} />, group: co.assetId ? t("Koin utama", "Main coins") : t("Koin lain dari CoinGecko", "More coins from CoinGecko"), keywords: co.name,
      }));
    } else if (assetClass === "crypto") {
      opts = list.map((a) => assetOption(a, PRIORITY_COINS.includes(a.symbol) ? t("Koin utama", "Main coins") : t("Koin lain", "Other coins")));
    } else {
      opts = list.map((a) => assetOption(a));
    }
    if (picked && !opts.some((o) => o.value === picked.id)) opts = [assetOption(picked), ...opts];
    return opts;
  }, [catalog.data, coinSearch.data, coinQuery, assetClass, picked, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = [...(catalog.data?.assets ?? []), ...(picked ? [picked] : [])];
  const effAssetId = assetId || (assetClass === "fiat" ? all.find((a) => a.symbol === "IDR")?.id : assetClass === "gold" ? all[0]?.id : undefined) || "";
  const asset = all.find((a) => a.id === effAssetId);
  const needsValue = !!asset && asset.symbol !== "IDR";
  const suggested = needsValue ? estimate(asset?.price, amount) : null;
  const goldAsset = assetClass === "gold";

  function pickBrand(key: string) {
    const next = brandByKey(key);
    setBrandKey(key);
    if (next && !nameTouched && !editing) setName(next.name);
    if (next && category && ASSET_CLASS_OF_CATEGORY[next.category] !== assetClass) { setAssetId(""); setPicked(null); setCoinQuery(""); setFx(""); }
  }

  async function pickAsset(value: string) {
    setError("");
    if (!value.startsWith("cg:")) { setAssetId(value); setFx(""); return; }
    setBusy(true);
    try {
      const added = await client.addCrypto(value.slice(3));
      setPicked(added);
      setAssetId(added.id);
      setFx("");
      void mutate((k) => typeof k === "string" && k.startsWith("/assets"));
    } catch (e) {
      setError(`${t("Koin tidak dapat ditambahkan", "This coin could not be added")}: ${e instanceof ApiError ? e.message : t("coba lagi", "try again")}`);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setError("");
    if (!brand || !category) return setError(t("Pilih jenis rekening", "Choose an account type"));
    if (!name.trim()) return setError(t("Nama rekening wajib diisi", "Account name is required"));
    const kind = KIND_OF_CATEGORY[category];
    setBusy(true);
    try {
      if (editing && id) {
        await client.updateAccount(id, { name: name.trim(), kind, brandKey: brand.key, includeInNetWorth: includeNet });
      } else {
        if (amount && !isAmountOrZero(amount)) { setBusy(false); return setError(t("Saldo awal harus berupa angka, contoh 1000000", "Opening balance must be a number, e.g. 1000000")); }
        if (amount && Number(amount) > 0 && needsValue && !isAmountOrZero(fx)) { setBusy(false); return setError(t("Isi nilai dalam rupiah untuk aset ini", "Enter the value in rupiah for this asset")); }
        await client.createAccount({
          name: name.trim(), kind, brandKey: brand.key, includeInNetWorth: includeNet,
          ...(amount && effAssetId ? { openingBalance: { assetId: effAssetId, quantity: amount, ...(needsValue ? { functionalAmount: fx } : {}) } } : {}),
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
          <T v="title" accessibilityRole="header">{editing ? t("Edit rekening", "Edit account") : t("Tambah rekening", "Add account")}</T>
          <Btn label={t("Tutup", "Close")} kind="ghost" small onPress={() => router.back()} />
        </View>
        {error ? <Banner tone="err">{error}</Banner> : null}

        <SearchPicker label={t("Jenis", "Type")} value={brandKey} onChange={pickBrand} options={brandOptions} placeholder={t("Pilih jenis rekening", "Choose account type")} searchPlaceholder={t("Cari bank, e-wallet, bursa…", "Search banks, e-wallets, exchanges…")} />
        <Field label={t("Nama rekening", "Account name")} value={name} onChangeText={(v) => { setName(v); setNameTouched(true); }} placeholder={t("mis. Tabungan BCA", "e.g. BCA Savings")} maxLength={80} />

        {!editing && assetClass && !goldAsset ? (
          <SearchPicker
            label={t("Aset saldo awal", "Opening balance asset")} value={effAssetId} onChange={(v) => void pickAsset(v)} options={assetOptions}
            searchPlaceholder={assetClass === "crypto" ? t("Cari koin, mis. near atau pepe…", "Search coins, e.g. near or pepe…") : t("Cari mata uang…", "Search currencies…")}
            onQuery={assetClass === "crypto" ? setCoinQuery : undefined} loading={catalog.isLoading || coinSearch.isLoading || busy}
            footer={assetClass === "crypto" ? t("Ketik untuk mencari semua koin di CoinGecko. Koin yang belum ada akan ditambahkan.", "Type to search every coin on CoinGecko. Coins not listed yet will be added.") : undefined}
          />
        ) : null}

        {!editing && assetClass ? (
          <Field
            label={goldAsset ? t("Berat emas (gram)", "Gold weight (grams)") : t("Saldo awal (opsional)", "Opening balance (optional)")} value={amount} onChangeText={(v) => setAmount(v.trim())} keyboardType="decimal-pad" placeholder="0"
            hint={needsValue && asset && isAmountOrZero(amount) && amount ? `${qty(amount)} ${goldAsset ? "g" : asset.symbol}` : !needsValue && amount && isAmountOrZero(amount) ? rp(amount) : undefined}
          />
        ) : null}

        {!editing && needsValue && amount && Number(amount) > 0 ? (
          <View style={{ gap: 8 }}>
            <Field label={t("Nilai dalam rupiah", "Value in rupiah")} value={fx} onChangeText={(v) => setFx(v.trim())} keyboardType="decimal-pad" placeholder={t("Total nilai dalam IDR", "Total value in IDR")} hint={t("Dipakai sebagai biaya perolehan awal.", "Used as the initial cost basis.")} />
            {suggested ? <Btn label={t(`Pakai perkiraan pasar: ${rp(suggested)}`, `Use market estimate: ${rp(suggested)}`)} kind="ghost" small onPress={() => setFx(suggested)} /> : null}
          </View>
        ) : null}

        <Pressable onPress={() => setIncludeNet(!includeNet)} accessibilityRole="switch" accessibilityState={{ checked: includeNet }} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 }}>
          <T>{t("Hitung dalam kekayaan bersih", "Count in net worth")}</T>
          <Switch value={includeNet} onValueChange={setIncludeNet} trackColor={{ true: c.gold, false: c.line }} thumbColor="#FFFFFF" />
        </Pressable>

        <Btn label={t("Simpan", "Save")} onPress={submit} busy={busy} />
      </Screen>
    </KeyboardAvoidingView>
  );
}
