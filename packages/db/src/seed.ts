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
