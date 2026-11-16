import type { DashboardService } from "./dashboard.service";
import type { MarketDataService } from "./market/market.service";

/** Price sync followed by a net-worth snapshot for every workspace. Errors are logged by name only. */
export function startScheduler(deps: { market: MarketDataService; dashboard: DashboardService; intervalMs: number }): () => void {
  const tick = async () => {
    try {
      const { updated, failed } = await deps.market.sync();
      const snaps = await deps.dashboard.snapshotAll();
      console.log(`[scheduler] prices updated: ${updated}, snapshots: ${snaps}${failed.length ? `, failed sources: ${failed.join(", ")}` : ""}`);
    } catch (err) {
      console.error("[scheduler] failed:", err instanceof Error ? err.name : "unknown");
    }
  };
  void tick();
  const timer = setInterval(tick, deps.intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
