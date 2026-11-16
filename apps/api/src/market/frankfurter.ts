import { dec } from "@bandha/ledger";
import type { FxProvider } from "./provider";

/**
 * ECB reference rates via Frankfurter (free, no key). Rates are fetched against EUR, so
 * rupiah per unit of X = rate(IDR) / rate(X), computed from two well-precise numbers
 * (inverting a rate quoted against IDR would only keep a few significant digits).
 */
export class FrankfurterProvider implements FxProvider {
  readonly name = "frankfurter";

  constructor(private readonly fetchFn: typeof fetch = fetch, private readonly baseUrl = "https://api.frankfurter.dev/v1") {}

  async fetchIdrRates(codes: string[]): Promise<Record<string, string>> {
    const wanted = [...new Set(codes.filter((c) => /^[A-Z]{3}$/.test(c) && c !== "IDR"))];
    if (wanted.length === 0) return {};

    const url = new URL(`${this.baseUrl}/latest`);
    url.searchParams.set("base", "EUR");
    url.searchParams.set("symbols", ["IDR", ...wanted.filter((c) => c !== "EUR")].join(","));
    const res = await this.fetchFn(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Frankfurter responded ${res.status}`);

    const body = (await res.json()) as { rates?: Record<string, unknown> };
    const rates: Record<string, unknown> = { ...(body.rates ?? {}), EUR: 1 };
    const idrPerEur = rates["IDR"];
    if (typeof idrPerEur !== "number" || !(idrPerEur > 0)) throw new Error("Frankfurter returned no IDR rate");

    const out: Record<string, string> = {};
    for (const code of wanted) {
      const r = rates[code];
      if (typeof r === "number" && r > 0) out[code] = dec(String(idrPerEur)).div(dec(String(r))).toDecimalPlaces(10).toFixed();
    }
    return out;
  }
}
