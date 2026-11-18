import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { SQLITE_BUSY_TIMEOUT_MS } from "../../shared/limits.ts";
import * as schema from "./schema.ts";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

export type Db = BunSQLiteDatabase<typeof schema>;

export type DatabaseHandle = {
  db: Db;
  /** Koneksi mentah; hanya untuk PRAGMA, backup, dan tes. Query biasa lewat repositori. */
  sqlite: Database;
  /** Salinan utuh database ke `path` (`VACUUM INTO`; file belum boleh ada). Sinkron, aman selama WAL aktif. */
  backupInto(path: string): void;
  close(): void;
};

/**
 * Membuka database, menyalakan PRAGMA wajib, lalu menjalankan migrasi yang belum diterapkan.
 * `path` boleh ":memory:" untuk tes. Transaksi bun:sqlite sinkron: jangan `await` di dalamnya.
 */
export function openDatabase(path: string): DatabaseHandle {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path, { create: true, strict: true });
  sqlite.run("PRAGMA journal_mode = WAL");
  sqlite.run("PRAGMA synchronous = NORMAL");
  sqlite.run("PRAGMA foreign_keys = ON");
  sqlite.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  const db = drizzle({ client: sqlite, schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return {
    db,
    sqlite,
    backupInto: (path) => sqlite.run("VACUUM INTO ?", [path]),
    close: () => sqlite.close(),
  };
}
