import type { Db } from "@bandha/db";

/** A Drizzle transaction handle. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type Env = { Variables: { userId: string; workspaceId: string } };

/** Drizzle wraps driver errors, so the Postgres code can be on err or err.cause. */
export function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, i = 0; typeof e === "object" && e !== null && i < 3; i++) {
    if ((e as { code?: unknown }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
