/**
 * Eksekutor query repositori: koneksi Drizzle atau transaksi di dalamnya. Semua fungsi repositori menerima
 * eksekutor sebagai argumen pertama, jadi bisa digabung dalam satu transaksi.
 */
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { Db } from "../client.ts";
import type * as schema from "../schema.ts";

export type Executor = BaseSQLiteDatabase<"sync", void, typeof schema>;

/**
 * Menjalankan `work` dalam satu transaksi. Transaksi bun:sqlite sinkron: `work` tidak boleh async dan tidak boleh
 * berisi `await` (AGENTS.md §3).
 */
export function transact<T>(db: Db, work: (tx: Executor) => T): T {
  return db.transaction((tx) => work(tx));
}
