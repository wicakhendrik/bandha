"use client";
import { useMemo, useState } from "react";
import useSWR, { mutate } from "swr";
import {
  ASSET_CLASS_OF_CATEGORY, BRANDS, GENERIC_BRAND_OF_KIND, KIND_OF_CATEGORY, PRIORITY_COINS, brandByKey, categoryLabel, guessBrand,
  type Account, type Asset, type AssetClass, type CoinChoice,
} from "@bandha/api-client";
import { api, errorText, fetcher } from "@/lib/api";
import { isAmountOrZero, qty, rp } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { BrandLogo, CoinLogo } from "./logos";
import { Modal } from "./modal";
import { Select, type Option } from "./select";

/** The Jenis (brand) an existing account maps to: its saved brand, else a guess from its name, else a generic one for its kind. */
function brandKeyOf(a: Account): string {
  return brandByKey(a.brandKey)?.key ?? guessBrand(a.name)?.key ?? GENERIC_BRAND_OF_KIND[a.kind] ?? "bank-lainnya";
}

/** Rupiah per unit x quantity, as a plain decimal string, or null when either side is unknown. */
function estimate(price: string | null | undefined, quantity: string): string | null {
  if (!price || !isAmountOrZero(quantity) || Number(quantity) === 0) return null;
  return String(Math.round(Number(price) * Number(quantity)));
}

export function AccountModal({ account, onClose }: { account?: Account; onClose: () => void }) {
  const { t, lang } = useI18n();
  const editing = !!account;

  const [brandKey, setBrandKey] = useState(account ? brandKeyOf(account) : "");
  const [name, setName] = useState(account?.name ?? "");
  const [nameTouched, setNameTouched] = useState(false);
  const [includeNet, setIncludeNet] = useState(account?.includeInNetWorth ?? true);
  const [assetId, setAssetId] = useState("");
  const [picked, setPicked] = useState<Asset | null>(null); // a coin added on the fly
  const [coinQuery, setCoinQuery] = useState("");
  const [amount, setAmount] = useState("");
  const [fx, setFx] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const brand = brandByKey(brandKey);
  const category = brand?.category;
  const assetClass: AssetClass | null = category ? ASSET_CLASS_OF_CATEGORY[category] : null;

  // The catalog for the chosen kind of account: currencies for banks/e-wallets/cash, coins for exchanges/wallets, grams for gold.
  const catalog = useSWR<{ assets: Asset[] }>(!editing && assetClass ? `/assets?kind=${assetClass}` : null, fetcher);
  const coinSearch = useSWR<{ coins: CoinChoice[]; remote: boolean }>(
    !editing && assetClass === "crypto" && coinQuery.length >= 2 ? `/assets/crypto/search?q=${encodeURIComponent(coinQuery)}` : null, fetcher,
  );

  const currencyNames = useMemo(() => {
    try { return new Intl.DisplayNames([lang], { type: "currency" }); } catch { return null; }
  }, [lang]);

  const assetOption = (a: Asset, group?: string): Option => ({
    value: a.id,
    label: a.symbol,
    hint: a.kind === "fiat" ? (currencyNames?.of(a.symbol) ?? a.name) : a.name,
    icon: <CoinLogo symbol={a.symbol} size={26} />,
    keywords: a.name,
    ...(group ? { group } : {}),
  });

  const brandOptions: Option[] = useMemo(
    () => BRANDS.map((b) => ({
      value: b.key, label: b.name, group: categoryLabel(b.category), icon: <BrandLogo brand={b} size={28} />,
      keywords: `${b.aliases.join(" ")} ${categoryLabel(b.category)}`,
    })),
    [lang],
  );

  const assetOptions: Option[] = useMemo(() => {
    const list = catalog.data?.assets ?? [];
    let opts: Option[];
    if (assetClass === "crypto" && coinQuery.length >= 2 && coinSearch.data) {
      opts = coinSearch.data.coins.map<Option>((c) => ({
        value: c.assetId ?? `cg:${c.coingeckoId}`,
        label: c.symbol,
        hint: c.assetId ? c.name : `${c.name} · ${t("accm.coinNew")}`,
        icon: <CoinLogo symbol={c.symbol} size={26} />,
        group: c.assetId ? t("accm.mainCoins") : t("accm.otherCoins"),
        keywords: c.name,
      }));
    } else if (assetClass === "crypto") {
      opts = list.map((a) => assetOption(a, PRIORITY_COINS.includes(a.symbol) ? t("accm.mainCoins") : t("accm.otherCoins")));
    } else {
      opts = list.map((a) => assetOption(a));
    }
    if (picked && !opts.some((o) => o.value === picked.id)) opts = [assetOption(picked), ...opts];
    return opts;
  }, [catalog.data, coinSearch.data, coinQuery, assetClass, picked, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const allAssets = [...(catalog.data?.assets ?? []), ...(picked ? [picked] : [])];
  // Defaults: IDR for currencies, the single gold asset for gold. Crypto must be chosen.
  const effAssetId = assetId || (assetClass === "fiat" ? allAssets.find((a) => a.symbol === "IDR")?.id : assetClass === "gold" ? allAssets[0]?.id : undefined) || "";
  const asset = allAssets.find((a) => a.id === effAssetId);
  const needsValue = !!asset && asset.symbol !== "IDR";
  const suggested = needsValue ? estimate(asset?.price, amount) : null;

  function pickBrand(key: string) {
    const next = brandByKey(key);
    setBrandKey(key);
    if (next && !nameTouched && !editing) setName(next.name);
    // A different kind of account holds different assets, so the previous choice no longer applies.
    if (next && category && ASSET_CLASS_OF_CATEGORY[next.category] !== assetClass) { setAssetId(""); setPicked(null); setCoinQuery(""); setFx(""); }
  }

  async function pickAsset(value: string) {
    setError("");
    if (!value.startsWith("cg:")) { setAssetId(value); setFx(""); return; }
    const id = value.slice(3);
    const hit = coinSearch.data?.coins.find((c) => c.coingeckoId === id);
    setBusy(true);
    try {
      const added = await api<{ asset: Asset }>("/assets/crypto", { method: "POST", body: { coingeckoId: id } });
      setPicked(added.asset);
      setAssetId(added.asset.id);
      setFx("");
      void mutate((k) => typeof k === "string" && k.startsWith("/assets"));
    } catch (e) {
      setError(`${t("accm.errCoin")}${hit ? ` (${hit.symbol})` : ""}: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!brand || !category) return setError(t("accm.errType"));
    if (!name.trim()) return setError(t("accm.errName"));
    const kind = KIND_OF_CATEGORY[category];

    if (editing) {
      setBusy(true);
      try {
        await api(`/accounts/${account!.id}`, { method: "PATCH", body: { name: name.trim(), kind, brandKey: brand.key, includeInNetWorth: includeNet } });
        await mutate(() => true);
        onClose();
      } catch (err) { setError(errorText(err)); setBusy(false); }
      return;
    }

    if (amount && !isAmountOrZero(amount)) return setError(t("accm.errBalance"));
    if (amount && Number(amount) > 0 && needsValue && !isAmountOrZero(fx)) return setError(t("accm.errValue"));
    setBusy(true);
    try {
      await api("/accounts", {
        method: "POST",
        body: {
          name: name.trim(), kind, brandKey: brand.key, includeInNetWorth: includeNet,
          ...(amount && effAssetId ? { openingBalance: { assetId: effAssetId, quantity: amount, ...(needsValue ? { functionalAmount: fx } : {}) } } : {}),
        },
      });
      await mutate(() => true);
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const goldAsset = assetClass === "gold";

  return (
    <Modal title={editing ? t("accm.edit") : t("accm.add")} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        {error && <div className="err" role="alert">{error}</div>}

        <div className="field"><label htmlFor="ajenis">{t("accm.type")}</label>
          <Select id="ajenis" value={brandKey} onChange={pickBrand} options={brandOptions} placeholder={t("accm.typePlaceholder")} searchPlaceholder={t("accm.typeSearch")} /></div>

        <div className="field"><label htmlFor="an">{t("accm.name")}</label>
          <input id="an" className="input" value={name} onChange={(e) => { setName(e.target.value); setNameTouched(true); }} placeholder={t("accm.namePlaceholder")} maxLength={80} /></div>

        {!editing && assetClass && !goldAsset && (
          <div className="field"><label htmlFor="aasset">{t("accm.asset")}</label>
            <Select
              id="aasset" value={effAssetId} onChange={(v) => void pickAsset(v)} options={assetOptions}
              searchPlaceholder={assetClass === "crypto" ? t("accm.coinSearch") : t("accm.fiatSearch")}
              onQuery={assetClass === "crypto" ? setCoinQuery : undefined}
              loading={catalog.isLoading || coinSearch.isLoading || busy}
              footer={assetClass === "crypto" ? t("accm.coinHint") : undefined}
            /></div>
        )}

        {!editing && assetClass && (
          <div className="field"><label htmlFor="am">{goldAsset ? t("accm.weight") : t("accm.balance")}</label>
            <input id="am" className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.trim())} placeholder="0" />
            {!needsValue && amount && isAmountOrZero(amount) && <span className="hint">{rp(amount)}</span>}
            {asset && needsValue && amount && isAmountOrZero(amount) && <span className="hint">{qty(amount)} {goldAsset ? "g" : asset.symbol}</span>}</div>
        )}

        {!editing && needsValue && amount && Number(amount) > 0 && (
          <div className="field"><label htmlFor="af">{t("accm.valueIdr")}</label>
            <input id="af" className="input num" inputMode="decimal" value={fx} onChange={(e) => setFx(e.target.value.trim())} placeholder={t("txm.valueIdrPlaceholder")} />
            <span className="hint">{t("accm.costHint")}</span>
            {suggested && (
              <span className="hint">{t("accm.suggest", { value: rp(suggested) })}{" "}
                <button type="button" className="link" style={{ background: "none", border: 0, cursor: "pointer", padding: 0 }} onClick={() => setFx(suggested)}>{t("accm.useSuggest")}</button></span>
            )}</div>
        )}

        <label className="check"><input type="checkbox" checked={includeNet} onChange={(e) => setIncludeNet(e.target.checked)} /> {t("accm.net")}</label>

        <div className="foot">
          <button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn pri" disabled={busy}>{busy ? t("common.saving") : t("common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}
