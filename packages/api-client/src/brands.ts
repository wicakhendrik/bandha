import { BRAND_GLYPHS, COIN_ICONS, type CoinPath } from "./icon-data.generated";
import { pick } from "./i18n";

/**
 * Logo data shared by web and mobile. Renderers only consume the specs returned here.
 *
 * - Coin marks come from the CC0 `cryptocurrency-icons` set; exchange glyphs from CC0 `simple-icons`.
 * - Indonesian banks and e-wallets are not available in open icon sets, so they are badges in the brand's colours
 *   (not the official artwork). Official logos can be added later without changing callers.
 */
export type BrandCategory = "bank" | "ewallet" | "exchange" | "wallet" | "broker" | "cash" | "gold";

export interface Brand {
  key: string;
  name: string;
  category: BrandCategory;
  bg: string;
  fg: string;
  /** Short text shown in the badge when there is no glyph. */
  mark: string;
  /** Slug into BRAND_GLYPHS (real vector glyph) when available. */
  glyph?: string;
  aliases: string[];
}

export const CATEGORY_LABEL: Record<BrandCategory, string> = {
  bank: "Bank", ewallet: "E-wallet", exchange: "Bursa kripto (CEX)", wallet: "Dompet kripto", broker: "Sekuritas / investasi", cash: "Tunai", gold: "Emas",
};
const CATEGORY_LABEL_EN: Record<BrandCategory, string> = {
  bank: "Bank", ewallet: "E-wallet", exchange: "Crypto exchange (CEX)", wallet: "Crypto wallet", broker: "Brokerage / investment", cash: "Cash", gold: "Gold",
};
export const categoryLabel = (c: BrandCategory): string => pick(CATEGORY_LABEL[c], CATEGORY_LABEL_EN[c]);

/**
 * The single "Jenis" choice drives everything else: the account type stored in the database, and which assets
 * make sense for the opening balance (cash-like accounts hold currencies, exchanges and wallets hold crypto, gold holds grams).
 */
export const KIND_OF_CATEGORY: Record<BrandCategory, string> = {
  bank: "bank", ewallet: "ewallet", exchange: "exchange", wallet: "wallet", broker: "brokerage", cash: "cash", gold: "gold",
};
export type AssetClass = "fiat" | "crypto" | "gold";
export const ASSET_CLASS_OF_CATEGORY: Record<BrandCategory, AssetClass> = {
  bank: "fiat", ewallet: "fiat", cash: "fiat", broker: "fiat", exchange: "crypto", wallet: "crypto", gold: "gold",
};

/** Account types in the order the filter row shows them; `kinds` are the stored kinds each filter covers. */
export const ACCOUNT_FILTERS: Array<{ key: string; kinds: string[] }> = [
  { key: "bank", kinds: ["bank"] }, { key: "ewallet", kinds: ["ewallet"] }, { key: "exchange", kinds: ["exchange"] },
  { key: "wallet", kinds: ["wallet"] }, { key: "gold", kinds: ["gold"] }, { key: "brokerage", kinds: ["brokerage"] },
  { key: "cash", kinds: ["cash"] }, { key: "other", kinds: ["other", "property"] },
];

const b = (key: string, name: string, category: BrandCategory, bg: string, mark: string, extra: Partial<Brand> = {}): Brand => ({
  key, name, category, bg, fg: "#FFFFFF", mark, aliases: [key, name.toLowerCase()], ...extra,
});

export const BRANDS: Brand[] = [
  // Banks
  b("bca", "BCA", "bank", "#00529C", "BCA", { aliases: ["bca", "bank central asia"] }),
  b("blu", "blu by BCA", "bank", "#0093E9", "blu", { aliases: ["blu", "blu by bca", "blu bca"] }),
  b("mandiri", "Bank Mandiri", "bank", "#002D62", "MDR", { fg: "#F6B426", aliases: ["mandiri", "bank mandiri"] }),
  b("bni", "BNI", "bank", "#F15A24", "BNI", { aliases: ["bni", "bank negara indonesia"] }),
  b("bri", "BRI", "bank", "#00529C", "BRI", { aliases: ["bri", "bank rakyat indonesia"] }),
  b("bsi", "BSI", "bank", "#00A39D", "BSI", { aliases: ["bsi", "bank syariah indonesia"] }),
  b("cimb", "CIMB Niaga", "bank", "#7D0000", "CIMB", { aliases: ["cimb", "cimb niaga"] }),
  b("jago", "Bank Jago", "bank", "#FF6A13", "Jago", { aliases: ["jago", "bank jago"] }),
  b("seabank", "SeaBank", "bank", "#FF5722", "Sea", { aliases: ["seabank", "sea bank"] }),
  b("jenius", "Jenius", "bank", "#00A4E4", "J", { aliases: ["jenius", "btpn"] }),
  b("bank-lainnya", "Bank lainnya", "bank", "#5C3A21", "Bk", { aliases: ["bank lainnya"] }),
  // E-wallets
  b("gopay", "GoPay", "ewallet", "#00AED6", "GoPay", { aliases: ["gopay", "go pay", "gojek"] }),
  b("ovo", "OVO", "ewallet", "#4C3494", "OVO", { aliases: ["ovo"] }),
  b("dana", "DANA", "ewallet", "#118EEA", "DANA", { aliases: ["dana"] }),
  b("shopeepay", "ShopeePay", "ewallet", "#EE4D2D", "SPay", { aliases: ["shopeepay", "shopee pay", "shopee"] }),
  b("linkaja", "LinkAja", "ewallet", "#E82529", "LA", { aliases: ["linkaja", "link aja"] }),
  b("paypal", "PayPal", "ewallet", "#003087", "PP", { glyph: "paypal", aliases: ["paypal"] }),
  b("ewallet-lainnya", "E-wallet lainnya", "ewallet", "#2F6F6F", "EW", { aliases: ["ewallet lainnya", "e wallet lainnya"] }),
  // Centralised exchanges
  b("indodax", "Indodax", "exchange", "#0C1E3C", "IDX", { aliases: ["indodax"] }),
  b("tokocrypto", "Tokocrypto", "exchange", "#081B2B", "TKO", { aliases: ["tokocrypto", "toko crypto"] }),
  b("pintu", "Pintu", "exchange", "#0F62FE", "Pintu", { aliases: ["pintu"] }),
  b("binance", "Binance", "exchange", "#1E2026", "BNB", { fg: "#F0B90B", glyph: "binance", aliases: ["binance"] }),
  b("bybit", "Bybit", "exchange", "#121214", "Bybit", { fg: "#F7A600", aliases: ["bybit"] }),
  b("bitget", "Bitget", "exchange", "#00F0FF", "BG", { fg: "#0A0A0A", aliases: ["bitget"] }),
  b("okx", "OKX", "exchange", "#000000", "OKX", { glyph: "okx", aliases: ["okx", "okex"] }),
  b("bingx", "BingX", "exchange", "#0052FF", "BX", { aliases: ["bingx"] }),
  b("gateio", "Gate.io", "exchange", "#2354E6", "Gate", { aliases: ["gate", "gateio", "gate io"] }),
  b("coinbase", "Coinbase", "exchange", "#0052FF", "CB", { glyph: "coinbase", aliases: ["coinbase"] }),
  b("kucoin", "KuCoin", "exchange", "#01BC8D", "KC", { glyph: "kucoin", aliases: ["kucoin"] }),
  b("kraken", "Kraken", "exchange", "#7132F5", "K", { aliases: ["kraken"] }),
  b("exchange-lainnya", "Bursa kripto lainnya", "exchange", "#1E3A5F", "CEX", { aliases: ["bursa kripto lainnya"] }),
  // Crypto wallets
  b("metamask", "MetaMask", "wallet", "#F6851B", "MM", { aliases: ["metamask", "meta mask"] }),
  b("trustwallet", "Trust Wallet", "wallet", "#0500FF", "TW", { aliases: ["trust wallet", "trustwallet"] }),
  b("phantom", "Phantom", "wallet", "#AB9FF2", "Ph", { fg: "#1C1C1C", aliases: ["phantom"] }),
  b("ledger", "Ledger", "wallet", "#111111", "L", { aliases: ["ledger"] }),
  b("trezor", "Trezor", "wallet", "#141609", "T", { glyph: "trezor", aliases: ["trezor"] }),
  b("wallet-eth", "Dompet Ethereum", "wallet", "#627EEA", "ETH", { aliases: ["wallet eth", "dompet eth", "dompet ethereum", "eth wallet"] }),
  b("wallet-sol", "Dompet Solana", "wallet", "#9945FF", "SOL", { aliases: ["wallet sol", "dompet sol", "dompet solana", "sol wallet"] }),
  b("wallet-btc", "Dompet Bitcoin", "wallet", "#F7931A", "BTC", { aliases: ["wallet btc", "dompet btc", "dompet bitcoin", "btc wallet"] }),
  b("wallet-sui", "Dompet Sui", "wallet", "#4BA2FF", "SUI", { aliases: ["wallet sui", "dompet sui", "sui wallet"] }),
  b("wallet-lainnya", "Dompet kripto lainnya", "wallet", "#4B3F72", "W", { aliases: ["dompet kripto lainnya"] }),
  // Brokers / investment
  b("stockbit", "Stockbit", "broker", "#00AA5B", "SB", { aliases: ["stockbit"] }),
  b("bibit", "Bibit", "broker", "#45B26B", "BB", { aliases: ["bibit"] }),
  b("broker-lainnya", "Sekuritas lainnya", "broker", "#2E7D5B", "Sk", { aliases: ["sekuritas lainnya"] }),
  // Cash
  b("tunai", "Tunai", "cash", "#10B981", "Rp", { aliases: ["tunai", "cash", "dompet tunai", "uang tunai"] }),
  // Gold
  b("antam", "Emas Antam", "gold", "#C9A227", "Au", { fg: "#3A2A00", aliases: ["antam", "emas antam", "logam mulia"] }),
  b("pegadaian", "Pegadaian", "gold", "#0A8A4A", "Peg", { aliases: ["pegadaian", "tabungan emas"] }),
  b("emas-lainnya", "Emas lainnya", "gold", "#D4A017", "Au", { fg: "#3A2A00", aliases: ["emas lainnya", "emas fisik", "emas"] }),
];

const BY_KEY = new Map(BRANDS.map((x) => [x.key, x]));

export const brandByKey = (key: string | null | undefined): Brand | undefined => (key ? BY_KEY.get(key) : undefined);

const normalise = (s: string) => s.toLowerCase().split("").map((c) => (/[a-z0-9]/.test(c) ? c : " ")).join("").split(" ").filter(Boolean).join(" ");

/**
 * Finds a brand by whole-word match of its aliases in a free-text name ("Tabungan BCA" -> bca).
 * Whole words only, so "Brimob" never matches BRI and "Solusi" never matches SOL.
 */
export function guessBrand(name: string): Brand | undefined {
  const hay = ` ${normalise(name)} `;
  let best: { brand: Brand; len: number } | undefined;
  for (const brand of BRANDS) {
    for (const alias of brand.aliases) {
      const a = normalise(alias);
      if (a && hay.includes(` ${a} `) && (!best || a.length > best.len)) best = { brand, len: a.length };
    }
  }
  return best?.brand;
}

/** Visual spec the renderers draw. */
export interface BadgeSpec {
  bg: string;
  fg: string;
  mark: string;
  glyph?: { path: string; hex: string };
}

const KIND_FALLBACK: Record<string, string> = {
  bank: "#5C3A21", ewallet: "#2F6F6F", exchange: "#1E3A5F", brokerage: "#45B26B", cash: "#10B981", gold: "#C58A2B", property: "#7A5C3E", other: "#6B5B4B",
};

export function initialsOf(name: string): string {
  const words = name.split(" ").filter(Boolean);
  const letters = words.length > 1 ? words.slice(0, 2).map((w) => w[0]!).join("") : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/** Logo for an account: explicit brandKey first, then a guess from its name, then a monogram by account kind. */
export function accountBadge(account: { brandKey?: string | null; name: string; kind: string }): BadgeSpec {
  const brand = brandByKey(account.brandKey) ?? guessBrand(account.name);
  if (brand) {
    const g = brand.glyph ? BRAND_GLYPHS[brand.glyph] : undefined;
    return { bg: brand.bg, fg: brand.fg, mark: brand.mark, ...(g ? { glyph: g } : {}) };
  }
  return { bg: KIND_FALLBACK[account.kind] ?? KIND_FALLBACK.other!, fg: "#FFFFFF", mark: initialsOf(account.name) };
}

export function brandBadge(brand: Brand): BadgeSpec {
  const g = brand.glyph ? BRAND_GLYPHS[brand.glyph] : undefined;
  return { bg: brand.bg, fg: brand.fg, mark: brand.mark, ...(g ? { glyph: g } : {}) };
}

export type CoinSpec =
  | { type: "icon"; bg: string; paths: CoinPath[] }
  | { type: "badge"; bg: string; fg: string; mark: string };

// Colours for assets without an open-set icon. Known brand colours where we are sure, otherwise a stable hash.
const FALLBACK_COLORS: Record<string, { bg: string; fg: string; mark: string }> = {
  IDR: { bg: "#C8102E", fg: "#FFFFFF", mark: "Rp" },
  USD: { bg: "#2E7D32", fg: "#FFFFFF", mark: "$" },
  XAU: { bg: "#D4A017", fg: "#3A2A00", mark: "Au" },
  ADA: { bg: "#0033AD", fg: "#FFFFFF", mark: "ADA" },
  SUI: { bg: "#4BA2FF", fg: "#FFFFFF", mark: "SUI" },
  TON: { bg: "#0098EA", fg: "#FFFFFF", mark: "TON" },
  SHIB: { bg: "#FFA409", fg: "#1A1A1A", mark: "SHIB" },
};

function hashColor(s: string): string {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 45% 38%)`;
}

export function coinSpec(symbol: string): CoinSpec {
  const sym = symbol.toUpperCase();
  const icon = COIN_ICONS[sym];
  if (icon) return { type: "icon", bg: icon.bg, paths: icon.paths };
  const f = FALLBACK_COLORS[sym];
  if (f) return { type: "badge", ...f };
  return { type: "badge", bg: hashColor(sym), fg: "#FFFFFF", mark: sym.slice(0, 4) };
}

/** Coins listed first in pickers, in this order (the API orders its catalog the same way). */
export const PRIORITY_COINS = ["BTC", "ETH", "USDT", "USDC", "SOL", "SUI", "TON", "TRX", "XLM", "XRP", "NEAR", "BNB", "DAI", "ADA", "DOGE", "BCH"];

/** A sensible Jenis (brand) for an account that has only a stored kind, e.g. before it was given one. */
export const GENERIC_BRAND_OF_KIND: Record<string, string> = {
  bank: "bank-lainnya", ewallet: "ewallet-lainnya", exchange: "exchange-lainnya", wallet: "wallet-lainnya", brokerage: "broker-lainnya", cash: "tunai", gold: "emas-lainnya",
};
