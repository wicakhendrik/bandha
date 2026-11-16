import type { Pool } from "pg";
import { type Db } from "@bandha/db";
import { applyPlan, type ApplyResult } from "./finmap-apply";
import { buildPlan, type Plan, type PlanOptions } from "./finmap-plan";
import { loadFinmap } from "./finmap-source";

export interface RunOptions extends PlanOptions {
  email: string;
  /** Without this nothing is committed: the whole migration runs inside a transaction that is rolled back. */
  apply: boolean;
  /** Commit even though some transactions could not be migrated (they are listed in the report). */
  skipFailed?: boolean;
  /** Commit even though some balances differ from FinMap's (they are listed in the report). */
  allowMismatch?: boolean;
}

export interface RunReport {
  plan: Plan;
  /** Absent when blockers stopped the run before anything was written. */
  result?: ApplyResult;
  committed: boolean;
  /** Why it was not committed, when `apply` was requested. */
  notCommittedBecause?: string;
}

class Rollback extends Error {}

/**
 * The whole job for one FinMap person: read, plan, write, reconcile, and only then decide whether to commit. Because
 * the write always happens (and is rolled back for a dry run), a dry run reports exactly what a real run would do.
 */
export async function migrateOne(source: Pool, db: Db, opts: RunOptions): Promise<RunReport> {
  const data = await loadFinmap(source, opts.email);
  const plan = buildPlan(data, opts);
  if (plan.blockers.length > 0) return { plan, committed: false, notCommittedBecause: "Ada hal yang harus diputuskan dulu (lihat Penghalang)." };

  let result: ApplyResult | undefined;
  let why: string | undefined;
  try {
    await db.transaction(async (tx) => {
      result = await applyPlan(tx as unknown as Db, plan);
      if (!opts.apply) { why = "Dry-run: tidak ada yang ditulis."; throw new Rollback(); }
      if (result.failures.length > 0 && !opts.skipFailed) { why = `${result.failures.length} transaksi gagal dimigrasi. Perbaiki, atau jalankan dengan --skip-failed.`; throw new Rollback(); }
      if (result.mismatches.length > 0 && !opts.allowMismatch) { why = `${result.mismatches.length} saldo berbeda dari FinMap. Periksa, atau jalankan dengan --allow-mismatch.`; throw new Rollback(); }
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return { plan, result, committed: opts.apply && why === undefined, ...(why ? { notCommittedBecause: why } : {}) };
}
