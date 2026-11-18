import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SQLITE_BUSY_TIMEOUT_MS } from "../../shared/limits.ts";
import { type DatabaseHandle, openDatabase } from "./client.ts";
import { meta } from "./schema.ts";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function openTemp(): Promise<{ handle: DatabaseHandle; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), "aag-db-"));
  const path = join(dir, "nested", "app.db");
  const handle = openDatabase(path);
  cleanups.push(async () => {
    handle.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { handle, path };
}

function pragma(handle: DatabaseHandle, name: string): unknown {
  const row = handle.sqlite.query(`PRAGMA ${name}`).get();
  return row ? Object.values(row)[0] : undefined;
}

describe("openDatabase", () => {
  test("menyalakan WAL, foreign keys, dan busy_timeout", async () => {
    const { handle } = await openTemp();
    expect(pragma(handle, "journal_mode")).toBe("wal");
    expect(pragma(handle, "foreign_keys")).toBe(1);
    expect(pragma(handle, "busy_timeout")).toBe(SQLITE_BUSY_TIMEOUT_MS);
  });

  test("menjalankan migrasi: tabel meta bisa dipakai lewat Drizzle", async () => {
    const { handle } = await openTemp();
    handle.db.insert(meta).values({ key: "dibuat", value: "2026-11-13" }).run();
    expect(handle.db.select().from(meta).all()).toEqual([{ key: "dibuat", value: "2026-11-13" }]);
  });

  test("membuka ulang database yang sudah termigrasi tidak gagal dan data tetap ada", async () => {
    const { handle, path } = await openTemp();
    handle.db.insert(meta).values({ key: "k", value: "v" }).run();
    handle.close();
    const again = openDatabase(path);
    try {
      expect(again.db.select().from(meta).all()).toEqual([{ key: "k", value: "v" }]);
    } finally {
      again.close();
    }
  });

  test("backupInto: salinan utuh termasuk data yang masih di WAL; target yang sudah ada ditolak", async () => {
    const { handle, path } = await openTemp();
    handle.db.insert(meta).values({ key: "k", value: "v" }).run();
    const copyPath = join(dirname(path), "salinan.db");
    handle.backupInto(copyPath);
    const copy = openDatabase(copyPath);
    try {
      expect(copy.db.select().from(meta).all()).toEqual([{ key: "k", value: "v" }]);
    } finally {
      copy.close();
    }
    expect(() => handle.backupInto(copyPath)).toThrow();
  });

  test("transaksi sinkron di-rollback bila ada error", async () => {
    const { handle } = await openTemp();
    expect(() =>
      handle.db.transaction((tx) => {
        tx.insert(meta).values({ key: "a", value: "1" }).run();
        throw new Error("gagal di tengah transaksi");
      }),
    ).toThrow("gagal di tengah transaksi");
    expect(handle.db.select().from(meta).all()).toEqual([]);
  });
});
