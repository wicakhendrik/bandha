import { dec } from "@bandha/ledger";
import type { FxProvider } from "./provider";

/**
 * Uses a near-live FX source, but cross-checks it against a trusted reference (the ECB fix) so one bad number from
 * the live source can never reach the ledger's valuations:
 *  - live and reference agree within `maxDeviation`: use the live rate (it is fresher);
 *  - they disagree by more: use the reference (an old rate beats a wrong one);
 *  - only one of them has the currency (or only one source answered): use that one.
 * Throws only when both sources fail. `sourceFor` reports which source each stored rate came from.
 */
export class LiveFxProvider implements FxProvider {
  readonly name: string;
  private readonly used = new Map<string, string>();

  constructor(
    private readonly live: FxProvider,
    private readonly reference: FxProvider,
    private readonly maxDeviation = 0.05,
  ) {
    this.name = live.name;
  }

  async fetchIdrRates(codes: string[]): Promise<Record<string, string>> {
    const [l, r] = await Promise.allSettled([this.live.fetchIdrRates(codes), this.reference.fetchIdrRates(codes)]);
    if (l.status === "rejected" && r.status === "rejected") throw l.reason;
    const liveRates = l.status === "fulfilled" ? l.value : {};
    const refRates = r.status === "fulfilled" ? r.value : {};

    this.used.clear();
    const out: Record<string, string> = {};
    for (const code of new Set(codes)) {
      const a = liveRates[code];
      const b = refRates[code];
      let pick: "live" | "reference" | null = null;
      if (a && b) pick = dec(a).minus(dec(b)).abs().div(dec(b)).lte(this.maxDeviation) ? "live" : "reference";
      else if (a) pick = "live";
      else if (b) pick = "reference";
      if (!pick) continue;
      out[code] = pick === "live" ? a! : b!;
      this.used.set(code, pick === "live" ? this.live.name : this.reference.name);
    }
    return out;
  }

  sourceFor(code: string): string {
    return this.used.get(code) ?? this.name;
  }
}
