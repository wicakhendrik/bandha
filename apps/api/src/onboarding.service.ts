import { and, count, eq, isNull, ne } from "drizzle-orm";
import { accounts, transactions, users, type Db } from "@bandha/db";

export interface OnboardingStatus {
  /** Active accounts the person has added. */
  accounts: number;
  /** Real transactions: opening balances do not count, they are how an account starts. */
  transactions: number;
  dismissed: boolean;
  /** Both basics are done: an account, and something recorded in it. */
  complete: boolean;
  /** Whether the getting-started guide should still be offered. */
  show: boolean;
}

/**
 * Setup progress is read from what the person has actually done, so it can never disagree with their data (an
 * imported or migrated ledger is "complete" without anyone ticking a box). Only "I do not want the guide" is stored.
 */
export class OnboardingService {
  constructor(private readonly db: Db) {}

  async status(workspaceId: string, userId: string): Promise<OnboardingStatus> {
    const [acc] = await this.db
      .select({ n: count() })
      .from(accounts)
      .where(and(eq(accounts.workspaceId, workspaceId), eq(accounts.isSystem, false), isNull(accounts.archivedAt)));
    const [tx] = await this.db
      .select({ n: count() })
      .from(transactions)
      .where(and(eq(transactions.workspaceId, workspaceId), eq(transactions.status, "posted"), ne(transactions.type, "opening")));
    const [u] = await this.db.select({ d: users.onboardingDismissedAt }).from(users).where(eq(users.id, userId));
    const a = acc?.n ?? 0;
    const t = tx?.n ?? 0;
    const dismissed = !!u?.d;
    const complete = a > 0 && t > 0;
    return { accounts: a, transactions: t, dismissed, complete, show: !dismissed && !complete };
  }

  async dismiss(userId: string): Promise<void> {
    await this.db.update(users).set({ onboardingDismissedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, userId));
  }
}
