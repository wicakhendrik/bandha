import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { assets, createDb } from "@bandha/db";
import { createApp } from "./app";
import type { MailMessage } from "./mailer";
import { loadConfig } from "./config";
import { FakeFxProvider, FakeProvider } from "./market/fake";
import { createServices } from "./services";

const url = process.env.DATABASE_URL ?? "postgres://bandha:bandha@localhost:5434/bandha";
export const config = loadConfig({ DATABASE_URL: url, JWT_SECRET: "t".repeat(40), MARKET_PROVIDER: "fake" });
export const { db, pool } = createDb(url);
export const services = createServices(db, new FakeProvider(), new FakeFxProvider());
/** Every email the API tried to send during the tests (the real mailer is never used). */
export const sentMail: MailMessage[] = [];
export const app = createApp({ db, config, services, mailer: { send: async (m) => { sentMail.push(m); } } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;

export async function call(method: string, path: string, token: string | null, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : {}) as Json };
}

export async function newUser() {
  const r = await call("POST", "/auth/register", null, { name: "Uji", email: `u-${randomUUID()}@test.dev`, password: "password-panjang-1" });
  expect(r.status).toBe(201);
  const token = r.json.tokens.accessToken as string;
  return { token, workspaceId: (await call("GET", "/me", token)).json.workspaceId as string };
}

export async function assetIds(token: string): Promise<Record<string, string>> {
  const list = (await call("GET", "/assets", token)).json.assets as Json[];
  return Object.fromEntries(list.map((a) => [a.symbol as string, a.id as string]));
}

/**
 * A crypto asset with no price source at all, so it stays unpriced no matter which providers have run
 * (the dev database is shared with real servers, which price every asset that has a provider ref).
 */
export async function createUnpricedAsset(): Promise<{ id: string; symbol: string }> {
  const symbol = `NP${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const [row] = await db.insert(assets).values({ symbol, name: `No price ${symbol}`, kind: "crypto", decimals: 8 }).returning({ id: assets.id });
  return { id: row!.id, symbol };
}
