import { config } from "dotenv";
import mysql from "mysql2/promise";
import { migrate, SCHEMA } from "../src/lib/schema.mjs";

config({ path: ".env.local" });
config();

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
});

for (const stmt of SCHEMA) {
  const name = stmt.match(/TABLE IF NOT EXISTS (\w+)/)?.[1];
  await conn.query(stmt);
  console.log(`✓ ${name}`);
}
await migrate(async (sql, params) => (await conn.query(sql, params))[0]);
console.log("✓ column migrations");
await conn.end();
console.log("Migration complete.");
