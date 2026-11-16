import { createDb } from "./index";
import { seedAssets } from "./seed";

const { db, pool } = createDb(process.env.DATABASE_URL ?? "postgres://bandha:bandha@localhost:5434/bandha");
console.log(`Seeded ${await seedAssets(db)} new assets`);
await pool.end();
