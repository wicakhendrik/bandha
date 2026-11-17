import { serve } from "@hono/node-server";
import { createDb } from "@bandha/db";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { startScheduler } from "./scheduler";
import { createFxProvider, createProvider, createServices, createStockProvider } from "./services";

const config = loadConfig();
const { db } = createDb(config.DATABASE_URL);
const services = createServices(db, createProvider(config), createFxProvider(config), createStockProvider(config));
const app = createApp({ db, config, services });

serve({ fetch: app.fetch, port: config.API_PORT }, (info) => {
  console.log(`Bandha API listening on :${info.port} (market provider: ${config.MARKET_PROVIDER})`);
});

startScheduler({ ...services, intervalMs: config.MARKET_SYNC_INTERVAL_MIN * 60_000 });
