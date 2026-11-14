/** Repositori aset. Kolom JSON divalidasi zod saat dibaca. */
import { and, asc, desc, eq, gte, inArray, isNull, type SQL, sql } from "drizzle-orm";
import { type AssetStatus, LastError, type RunState } from "../../../shared/asset.ts";
import type { AssetSort } from "../../../shared/asset-list.ts";
import { Brief } from "../../../shared/brief.ts";
import { ASSET_LIST_MAX, type TierBudget, TierBudgetSchema, type TierId } from "../../../shared/limits.ts";
import { type AssetState, INITIAL_STATE } from "../../domain/status.ts";
import { assets, versions } from "../schema.ts";
import type { Executor } from "./executor.ts";
import { type VersionRecord, versionFromRow } from "./versions.ts";

export type AssetRecord = Readonly<{
  id: string;
  name: string;
  prompt: string;
  tierId: TierId;
  /** Snapshot budget saat aset dibuat. */
  tier: TierBudget;
  sessionId: string | null;
  state: AssetState;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}>;

export type NewAsset = Readonly<{
  id: string;
  name: string;
  prompt: string;
  tierId: TierId;
  tier: TierBudget;
  now: number;
  /** Bawaan: `INITIAL_STATE`. Diisi saat menduplikat atau mengimpor aset yang sudah berjalan (eval). */
  state?: AssetState;
  sessionId?: string | null;
}>;

type Row = typeof assets.$inferSelect;

function stateColumns(state: AssetState) {
  return {
    status: state.status,
    runState: state.runState,
    lastError: state.lastError,
    brief: state.brief,
    approvedBaseVersion: state.approvedBaseVersion,
    currentVersion: state.currentVersion,
    buildsThisMessage: state.buildsThisMessage,
  };
}

function toRecord(row: Row): AssetRecord {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    tierId: row.tierId,
    tier: TierBudgetSchema.parse(row.tierSnapshot),
    sessionId: row.sessionId,
    state: {
      status: row.status,
      runState: row.runState,
      lastError: row.lastError === null ? null : LastError.parse(row.lastError),
      brief: row.brief === null ? null : Brief.parse(row.brief),
      approvedBaseVersion: row.approvedBaseVersion,
      currentVersion: row.currentVersion,
      buildsThisMessage: row.buildsThisMessage,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

export function insertAsset(x: Executor, input: NewAsset): AssetRecord {
  const row = x
    .insert(assets)
    .values({
      id: input.id,
      name: input.name,
      prompt: input.prompt,
      tierId: input.tierId,
      tierSnapshot: input.tier,
      sessionId: input.sessionId ?? null,
      ...stateColumns(input.state ?? INITIAL_STATE),
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning()
    .get();
  return toRecord(row);
}

/** Aset yang belum dihapus (atau termasuk yang dihapus bila `includeDeleted`). */
export function getAsset(
  x: Executor,
  id: string,
  options: { includeDeleted?: boolean } = {},
): AssetRecord | null {
  const row = x.select().from(assets).where(eq(assets.id, id)).get();
  if (row === undefined || (row.deletedAt !== null && options.includeDeleted !== true)) return null;
  return toRecord(row);
}

export type AssetSearch = Readonly<{
  /** Kata kunci (sudah di-trim): nama, prompt, kategori atau ringkasan brief. Kosong = tanpa pencarian. */
  text?: string;
  tierId?: TierId;
  statuses?: readonly AssetStatus[];
  /** Hanya aset yang diubah sejak waktu ini (ms epoch). */
  updatedSince?: number;
  /** Bawaan: terakhir diubah dulu. */
  sort?: AssetSort;
  /** Dibatasi `ASSET_LIST_MAX`. */
  limit?: number;
}>;

/** Baris daftar Gudang: aset + indeks versi terkininya (untuk info kartu dan thumbnail). */
export type AssetListRow = Readonly<{
  asset: AssetRecord;
  current: VersionRecord | null;
  /** Jumlah semua versi aset (dialog hapus: "beserta 3 versi"). */
  versionCount: number;
}>;

/** `%`, `_`, dan `\` dari pengguna dicari apa adanya, bukan sebagai wildcard LIKE (dipasangkan dengan `ESCAPE '\'`). */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** LIKE SQLite tidak membedakan huruf besar/kecil untuk ASCII. */
function textMatch(text: string): SQL {
  const pattern = likePattern(text);
  return sql`(${assets.name} LIKE ${pattern} ESCAPE '\\'
    OR ${assets.prompt} LIKE ${pattern} ESCAPE '\\'
    OR json_extract(${assets.brief}, '$.category') LIKE ${pattern} ESCAPE '\\'
    OR json_extract(${assets.brief}, '$.summary') LIKE ${pattern} ESCAPE '\\')`;
}

const ORDER: Readonly<Record<Exclude<AssetSort, "name">, readonly SQL[]>> = {
  updated: [desc(assets.updatedAt), desc(assets.id)],
  oldest: [asc(assets.updatedAt), asc(assets.id)],
};

/**
 * Urutan Nama memakai aturan bahasa (Intl), bukan `COLLATE NOCASE` SQLite yang hanya mengenal huruf ASCII: "Élan"
 * di antara "E" dan "F", "Peti 2" sebelum "Peti 10", tanpa membedakan huruf besar/kecil.
 */
const NAME_ORDER = new Intl.Collator("id", { sensitivity: "base", numeric: true });

/** Daftar Gudang: aset yang belum dihapus, sesuai kata kunci, filter, dan urutan. */
export function searchAssets(x: Executor, search: AssetSearch = {}): AssetListRow[] {
  const conditions: SQL[] = [isNull(assets.deletedAt)];
  if (search.text !== undefined && search.text !== "") conditions.push(textMatch(search.text));
  if (search.tierId !== undefined) conditions.push(eq(assets.tierId, search.tierId));
  if (search.statuses !== undefined) conditions.push(inArray(assets.status, [...search.statuses]));
  if (search.updatedSince !== undefined) conditions.push(gte(assets.updatedAt, search.updatedSince));
  // Subquery berkorelasi memakai alias sendiri: tabel `versions` sudah dipakai join versi terkini.
  const versionCount = sql<number>`(select count(*) from ${versions} as ${sql.identifier("counted")} where ${sql.identifier("counted")}.${sql.identifier(versions.assetId.name)} = ${assets.id})`;
  const limit = Math.min(search.limit ?? ASSET_LIST_MAX, ASSET_LIST_MAX);
  const query = x
    .select({ asset: assets, current: versions, versionCount })
    .from(assets)
    .leftJoin(versions, and(eq(versions.assetId, assets.id), eq(versions.n, assets.currentVersion)))
    .where(and(...conditions));
  const sort = search.sort ?? "updated";
  // Nama: semua baris yang cocok diurutkan di sini (satu pengguna, jumlahnya kecil); seri tetap urut id (sort stabil).
  const rows =
    sort === "name"
      ? query
          .orderBy(asc(assets.id))
          .all()
          .sort((a, b) => NAME_ORDER.compare(a.asset.name, b.asset.name))
          .slice(0, limit)
      : query
          .orderBy(...ORDER[sort])
          .limit(limit)
          .all();
  return rows.map((row) => ({
    asset: toRecord(row.asset),
    current: row.current === null ? null : versionFromRow(row.current),
    versionCount: row.versionCount,
  }));
}

/** Jumlah aset yang belum dihapus (judul Gudang "24 aset", tanpa filter). */
export function countAssets(x: Executor): number {
  return (
    x.select({ count: sql<number>`count(*)` }).from(assets).where(isNull(assets.deletedAt)).get()?.count ?? 0
  );
}

export function listAssetsByRunState(x: Executor, runStates: readonly RunState[]): AssetRecord[] {
  return x
    .select()
    .from(assets)
    .where(and(isNull(assets.deletedAt), inArray(assets.runState, [...runStates])))
    .all()
    .map(toRecord);
}

export function saveAssetState(x: Executor, id: string, state: AssetState, now: number): void {
  x.update(assets)
    .set({ ...stateColumns(state), updatedAt: now })
    .where(eq(assets.id, id))
    .run();
}

export function setSessionId(x: Executor, id: string, sessionId: string | null, now: number): void {
  x.update(assets).set({ sessionId, updatedAt: now }).where(eq(assets.id, id)).run();
}

export function renameAsset(x: Executor, id: string, name: string, now: number): void {
  x.update(assets).set({ name, updatedAt: now }).where(eq(assets.id, id)).run();
}

export function markAssetDeleted(x: Executor, id: string, now: number): void {
  x.update(assets).set({ deletedAt: now, updatedAt: now }).where(eq(assets.id, id)).run();
}
