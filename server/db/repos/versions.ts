/**
 * Indeks versi di database (untuk Gudang dan API). Isi versi tetap di folder `versions/vN` (write-once); baris ini
 * disalin dari `stats.json` + `manifest.json` saat versi dibuat atau saat pemulihan.
 */
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { AssetStats } from "../../../shared/asset-stats.ts";
import { type VersionReport, versionReport } from "../../../shared/version-report.ts";
import { versions } from "../schema.ts";
import type { Executor } from "./executor.ts";

const Budget = z.object({ ok: z.boolean() }).loose();
const Manifest = z
  .object({
    files: z.array(z.object({ name: z.string(), bytes: z.number(), sha256: z.string() })),
    meta: z.unknown().optional(),
  })
  .loose();

export type VersionRecord = Readonly<
  {
    assetId: string;
    n: number;
    stage: "base" | "textured";
    stats: AssetStats;
    budgetOk: boolean;
    files: ReadonlyArray<Readonly<{ name: string; bytes: number }>>;
    createdAt: number;
  } & VersionReport
>;

export type NewVersion = Readonly<{
  assetId: string;
  n: number;
  stage: "base" | "textured";
  stats: AssetStats;
  budget: unknown;
  manifest: unknown;
  createdAt: number;
}>;

/** Menambah baris versi; versi yang sudah tercatat tidak diubah (versi write-once). */
export function insertVersion(x: Executor, input: NewVersion): void {
  x.insert(versions).values(input).onConflictDoNothing().run();
}

/** Baris tabel `versions` → `VersionRecord` (juga dipakai join daftar aset). */
export function versionFromRow(row: typeof versions.$inferSelect): VersionRecord {
  const manifest = Manifest.parse(row.manifest);
  return {
    assetId: row.assetId,
    n: row.n,
    stage: row.stage,
    stats: AssetStats.parse(row.stats),
    budgetOk: Budget.parse(row.budget).ok,
    files: manifest.files.map((file) => ({ name: file.name, bytes: file.bytes })),
    ...versionReport(manifest.meta),
    createdAt: row.createdAt,
  };
}

/**
 * Duplikat aset: indeks versi disalin apa adanya ke aset baru (file versinya disalin service). `only`: hanya versi
 * yang foldernya sudah tersalin.
 */
export function copyVersions(
  x: Executor,
  fromAssetId: string,
  toAssetId: string,
  only?: ReadonlySet<number>,
): number {
  const rows = x
    .select()
    .from(versions)
    .where(eq(versions.assetId, fromAssetId))
    .all()
    .filter((row) => only === undefined || only.has(row.n));
  for (const row of rows)
    x.insert(versions)
      .values({ ...row, assetId: toAssetId })
      .run();
  return rows.length;
}

export function listVersionRecords(x: Executor, assetId: string): VersionRecord[] {
  return x
    .select()
    .from(versions)
    .where(eq(versions.assetId, assetId))
    .orderBy(asc(versions.n))
    .all()
    .map(versionFromRow);
}

export function getVersionRecord(x: Executor, assetId: string, n: number): VersionRecord | null {
  const row = x
    .select()
    .from(versions)
    .where(and(eq(versions.assetId, assetId), eq(versions.n, n)))
    .get();
  return row === undefined ? null : versionFromRow(row);
}
