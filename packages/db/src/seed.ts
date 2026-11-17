import { sql } from "drizzle-orm";
import type { Db } from "./index";
import { assets } from "./schema";

type Seed = typeof assets.$inferInsert;

/** Troy ounce in grams. Gold is quoted per ounce (PAX Gold) but held in grams. */
export const GRAMS_PER_TROY_OUNCE = "31.1034768";

/**
 * Currencies priced via the ECB reference rates (Frankfurter). provider_ref "fx:XXX" routes them to the FX provider
 * instead of CoinGecko. Names are English; clients localise them (Intl.DisplayNames).
 */
const FIAT: Array<[string, string]> = [
  ["USD", "US Dollar"], ["EUR", "Euro"], ["SGD", "Singapore Dollar"], ["MYR", "Malaysian Ringgit"], ["JPY", "Japanese Yen"],
  ["AUD", "Australian Dollar"], ["GBP", "British Pound"], ["CNY", "Chinese Yuan"], ["HKD", "Hong Kong Dollar"], ["KRW", "South Korean Won"],
  ["THB", "Thai Baht"], ["PHP", "Philippine Peso"], ["INR", "Indian Rupee"], ["CAD", "Canadian Dollar"], ["CHF", "Swiss Franc"],
  ["NZD", "New Zealand Dollar"], ["SEK", "Swedish Krona"], ["NOK", "Norwegian Krone"], ["DKK", "Danish Krone"], ["PLN", "Polish Zloty"],
  ["CZK", "Czech Koruna"], ["HUF", "Hungarian Forint"], ["RON", "Romanian Leu"], ["TRY", "Turkish Lira"], ["ZAR", "South African Rand"],
  ["BRL", "Brazilian Real"], ["MXN", "Mexican Peso"], ["ILS", "Israeli New Shekel"], ["ISK", "Icelandic Krona"],
];

const coin = (symbol: string, name: string, providerRef: string, decimals = 8): Seed => ({ symbol, name, kind: "crypto", decimals, providerRef });

/**
 * Stocks are priced from Yahoo Finance: provider_ref "yf:<Yahoo symbol>". Indonesian shares end in ".JK" and trade in whole
 * shares (a lot is 100) in rupiah; US shares and ETFs may be fractional and are quoted in dollars (converted to rupiah when priced).
 */
const idx = (symbol: string, name: string): Seed => ({ symbol, name, kind: "stock", decimals: 0, providerRef: `yf:${symbol}.JK` });
const us = (symbol: string, name: string): Seed => ({ symbol, name, kind: "stock", decimals: 6, providerRef: `yf:${symbol}` });

/** Popular Indonesian shares (mostly the LQ45 names). */
export const IDX_STOCKS: Seed[] = [
  idx("BBCA", "Bank Central Asia"), idx("BBRI", "Bank Rakyat Indonesia"), idx("BMRI", "Bank Mandiri"), idx("BBNI", "Bank Negara Indonesia"),
  idx("BRIS", "Bank Syariah Indonesia"), idx("ARTO", "Bank Jago"), idx("TLKM", "Telkom Indonesia"), idx("ISAT", "Indosat Ooredoo Hutchison"),
  idx("EXCL", "XL Axiata"), idx("TOWR", "Sarana Menara Nusantara"), idx("ASII", "Astra International"), idx("UNTR", "United Tractors"),
  idx("UNVR", "Unilever Indonesia"), idx("ICBP", "Indofood CBP Sukses Makmur"), idx("INDF", "Indofood Sukses Makmur"),
  idx("CPIN", "Charoen Pokphand Indonesia"), idx("JPFA", "Japfa Comfeed Indonesia"), idx("KLBF", "Kalbe Farma"), idx("SIDO", "Sido Muncul"),
  idx("MIKA", "Mitra Keluarga Karyasehat"), idx("HMSP", "HM Sampoerna"), idx("GGRM", "Gudang Garam"), idx("GOTO", "GoTo Gojek Tokopedia"),
  idx("BUKA", "Bukalapak"), idx("EMTK", "Elang Mahkota Teknologi"), idx("SCMA", "Surya Citra Media"), idx("BREN", "Barito Renewables Energy"),
  idx("AMMN", "Amman Mineral Internasional"), idx("ADRO", "Adaro Energy Indonesia"), idx("ADMR", "Adaro Minerals Indonesia"), idx("PTBA", "Bukit Asam"),
  idx("ITMG", "Indo Tambangraya Megah"), idx("HRUM", "Harum Energy"), idx("ANTM", "Aneka Tambang"), idx("MDKA", "Merdeka Copper Gold"),
  idx("INCO", "Vale Indonesia"), idx("TINS", "Timah"), idx("PGAS", "Perusahaan Gas Negara"), idx("MEDC", "Medco Energi Internasional"),
  idx("AKRA", "AKR Corporindo"), idx("ESSA", "ESSA Industries Indonesia"), idx("TPIA", "Chandra Asri Pacific"), idx("SMGR", "Semen Indonesia"),
  idx("INTP", "Indocement Tunggal Prakarsa"), idx("INKP", "Indah Kiat Pulp & Paper"), idx("TKIM", "Pabrik Kertas Tjiwi Kimia"),
  idx("ACES", "Aspirasi Hidup Indonesia"), idx("MAPI", "Mitra Adiperkasa"), idx("ERAA", "Erajaya Swasembada"), idx("CTRA", "Ciputra Development"),
  idx("BSDE", "Bumi Serpong Damai"), idx("PWON", "Pakuwon Jati"), idx("SMRA", "Summarecon Agung"), idx("JSMR", "Jasa Marga"),
];

/** Popular US shares and ETFs. */
export const US_STOCKS: Seed[] = [
  us("AAPL", "Apple"), us("MSFT", "Microsoft"), us("GOOGL", "Alphabet (Class A)"), us("AMZN", "Amazon"), us("NVDA", "NVIDIA"),
  us("META", "Meta Platforms"), us("TSLA", "Tesla"), us("AVGO", "Broadcom"), us("BRK-B", "Berkshire Hathaway (Class B)"), us("JPM", "JPMorgan Chase"),
  us("V", "Visa"), us("MA", "Mastercard"), us("UNH", "UnitedHealth Group"), us("JNJ", "Johnson & Johnson"), us("XOM", "Exxon Mobil"),
  us("WMT", "Walmart"), us("PG", "Procter & Gamble"), us("HD", "Home Depot"), us("KO", "Coca-Cola"), us("PEP", "PepsiCo"), us("COST", "Costco"),
  us("NFLX", "Netflix"), us("DIS", "Walt Disney"), us("ADBE", "Adobe"), us("CRM", "Salesforce"), us("AMD", "Advanced Micro Devices"),
  us("INTC", "Intel"), us("ORCL", "Oracle"), us("CSCO", "Cisco"), us("PYPL", "PayPal"), us("UBER", "Uber"), us("BA", "Boeing"), us("NKE", "Nike"),
  us("MCD", "McDonald's"), us("SBUX", "Starbucks"), us("PFE", "Pfizer"), us("MRK", "Merck"), us("ABBV", "AbbVie"), us("T", "AT&T"), us("VZ", "Verizon"),
  us("BAC", "Bank of America"), us("WFC", "Wells Fargo"), us("GS", "Goldman Sachs"), us("COIN", "Coinbase"), us("PLTR", "Palantir"),
  us("SPY", "SPDR S&P 500 ETF"), us("QQQ", "Invesco QQQ ETF"), us("VOO", "Vanguard S&P 500 ETF"), us("VTI", "Vanguard Total Stock Market ETF"),
];

// Quantity decimals per asset. Crypto kept to 8 places (satoshi-level) for display/input.
export const SEED_ASSETS: Seed[] = [
  { symbol: "IDR", name: "Rupiah Indonesia", kind: "fiat", decimals: 2 },
  ...FIAT.map<Seed>(([symbol, name]) => ({ symbol, name, kind: "fiat", decimals: 2, providerRef: `fx:${symbol}` })),
  // Main coins first (BTC ETH USDT USDC SOL SUI TON TRX XLM XRP NEAR BNB DAI ADA DOGE BCH), then a few more.
  coin("BTC", "Bitcoin", "bitcoin"), coin("ETH", "Ethereum", "ethereum"), coin("USDT", "Tether", "tether", 6), coin("USDC", "USD Coin", "usd-coin", 6),
  coin("SOL", "Solana", "solana"), coin("SUI", "Sui", "sui", 6), coin("TON", "Toncoin", "the-open-network", 6), coin("TRX", "TRON", "tron", 6),
  coin("XLM", "Stellar", "stellar", 7), coin("XRP", "XRP", "ripple", 6), coin("NEAR", "NEAR Protocol", "near", 6), coin("BNB", "BNB", "binancecoin"),
  coin("DAI", "Dai", "dai", 6), coin("ADA", "Cardano", "cardano", 6), coin("DOGE", "Dogecoin", "dogecoin"), coin("BCH", "Bitcoin Cash", "bitcoin-cash"),
  coin("DOT", "Polkadot", "polkadot"), coin("LTC", "Litecoin", "litecoin"), coin("AVAX", "Avalanche", "avalanche-2"), coin("LINK", "Chainlink", "chainlink"),
  coin("ATOM", "Cosmos", "cosmos", 6), coin("ETC", "Ethereum Classic", "ethereum-classic"), coin("UNI", "Uniswap", "uniswap"), coin("SHIB", "Shiba Inu", "shiba-inu", 2),
  { symbol: "XAU", name: "Emas (gram)", kind: "gold", decimals: 4, providerRef: "pax-gold", unitDivisor: GRAMS_PER_TROY_OUNCE },
  ...IDX_STOCKS,
  ...US_STOCKS,
];

/**
 * Idempotent: re-running never duplicates rows or changes ids. Existing rows only get their price source refreshed
 * (provider ref and unit divisor), so an asset the user added on demand is never overwritten.
 */
export async function seedAssets(db: Db): Promise<number> {
  const res = await db
    .insert(assets)
    .values(SEED_ASSETS)
    .onConflictDoUpdate({
      target: [assets.symbol, assets.kind],
      set: { providerRef: sql`excluded.provider_ref`, unitDivisor: sql`excluded.unit_divisor` },
    })
    .returning({ id: assets.id });
  return res.length;
}
