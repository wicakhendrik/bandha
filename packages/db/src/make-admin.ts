import { eq, sql } from "drizzle-orm";
import { createDb } from "./index";
import { adminAudit, users } from "./schema";

/**
 * Grants or removes admin rights from the command line (the only way: there is no API for it).
 *   pnpm db:make-admin someone@example.com            make admin
 *   pnpm db:make-admin someone@example.com --revoke   back to a normal user
 * Uses DATABASE_URL, like the migrations. The change is written to the admin audit log.
 */
const args = process.argv.slice(2);
const revoke = args.includes("--revoke");
const email = args.find((a) => !a.startsWith("--"))?.trim();
if (!email) {
  console.error("Usage: pnpm db:make-admin <email> [--revoke]");
  process.exit(1);
}

const url = process.env.DATABASE_URL ?? "postgres://bandha:bandha@localhost:5434/bandha";
const { db, pool } = createDb(url);

try {
  const [u] = await db.select().from(users).where(eq(sql`lower(${users.email})`, email.toLowerCase()));
  if (!u) throw new Error(`No account with that email: ${email}`);
  const role = revoke ? "user" : "admin";
  if (u.role === role) {
    console.log(`${u.email} is already ${role === "admin" ? "an admin" : "a normal user"}. Nothing changed.`);
  } else {
    if (role === "admin" && !u.emailVerifiedAt) throw new Error("That account has not verified its email yet. Verify it first.");
    if (role === "admin" && u.disabledAt) throw new Error("That account is disabled. Enable it first.");
    await db.transaction(async (tx) => {
      await tx.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, u.id));
      await tx.insert(adminAudit).values({ actorEmail: "cli", action: revoke ? "role.revoke" : "role.grant", targetUserId: u.id, targetEmail: u.email });
    });
    console.log(`${u.email} is now ${role === "admin" ? "an admin" : "a normal user"}.`);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : "Failed");
  process.exitCode = 1;
} finally {
  await pool.end();
}
