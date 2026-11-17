import type { Db } from "@bandha/db";
import type { Config } from "./config";
import { AssetsService } from "./assets.service";
import { DashboardService } from "./dashboard.service";
import { CoinGeckoProvider } from "./market/coingecko";
import { FakeFxProvider, FakeProvider, FakeStockProvider } from "./market/fake";
import { CoinGeckoFxProvider } from "./market/coingecko-fx";
import { FrankfurterProvider } from "./market/frankfurter";
import { LiveFxProvider } from "./market/live-fx";
import { YahooStockProvider } from "./market/yahoo";
import { MarketDataService } from "./market/market.service";
import { HoldingsService } from "./holdings.service";
import { PortfolioService } from "./portfolio.service";
import type { FxProvider, MarketDataProvider, StockProvider } from "./market/provider";

export function createProvider(config: Config): MarketDataProvider {
  return config.MARKET_PROVIDER === "fake" ? new FakeProvider() : new CoinGeckoProvider(config.COINGECKO_API_KEY);
}

export function createFxProvider(config: Config): FxProvider {
  return config.MARKET_PROVIDER === "fake" ? new FakeFxProvider() : new LiveFxProvider(new CoinGeckoFxProvider(config.COINGECKO_API_KEY), new FrankfurterProvider());
}

export function createStockProvider(config: Config): StockProvider {
  return config.MARKET_PROVIDER === "fake" ? new FakeStockProvider() : new YahooStockProvider();
}

export function createServices(db: Db, provider: MarketDataProvider, fx: FxProvider, stocks?: StockProvider) {
  const market = new MarketDataService(db, provider, fx, stocks);
  const dashboard = new DashboardService(db, market);
  const portfolio = new PortfolioService(db, market);
  const holdings = new HoldingsService(db, market);
  const assetCatalog = new AssetsService(db, market);
  return { market, dashboard, portfolio, holdings, assetCatalog };
}

export type Services = ReturnType<typeof createServices>;
