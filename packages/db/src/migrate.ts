import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { createDb } from "./index";

const url = process.env.DATABASE_URL ?? "postgres://bandha:bandha@localhost:5434/bandha";
const { db, pool } = createDb(url);

await migrate(db, { migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)) });
await pool.end();
console.log("Migrations applied");
