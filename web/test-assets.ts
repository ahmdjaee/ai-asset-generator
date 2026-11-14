/** Data aset tiruan untuk tes halaman (bentuk sama dengan respons `GET /api/assets` dan detail aset). */
import type { AssetData, AssetDetailData, VersionData } from "@/features/studio/queries.ts";
import type { AssetListData, AssetListItemData } from "@/lib/assets.ts";
import { DEFAULT_TIERS } from "../shared/limits.ts";

export const T0 = Date.UTC(2026, 10, 14, 7, 0, 0);

export function assetFixture(patch: Partial<AssetData> = {}): AssetData {
  return {
    id: "peti",
    name: "Peti harta kayu",
    prompt: "Peti harta kayu dengan engsel besi",
    tierId: "sedang",
    tier: DEFAULT_TIERS.sedang,
    status: "BASE_REVIEW",
    runState: "idle",
    lastError: null,
    brief: null,
    approvedBaseVersion: null,
    currentVersion: 1,
    buildsLeft: 7,
    createdAt: T0,
    updatedAt: T0,
    ...patch,
  };
}

export function versionFixture(patch: Partial<VersionData> = {}): VersionData {
  return {
    n: 1,
    stage: "base",
    stats: {
      triangles: 3388,
      vertices: 1954,
      materials: 0,
      drawCalls: 1,
      textures: [],
      bbox: { min: [-0.325, 0, -0.22], max: [0.325, 0.53, 0.22], size: [0.65, 0.53, 0.44] },
      bytes: 210_000,
    },
    budgetOk: true,
    files: [
      { name: "base.glb", bytes: 210_000 },
      { name: "web.glb", bytes: 164_000 },
    ],
    createdAt: T0,
    validation: { errors: 0, warnings: 0 },
    timings: { runtimeMs: 60_000, pipelineMs: 20_000, renderMs: 8_000, totalMs: 108_000 },
    optimize: { steps: ["dedup", "flatten+join+weld", "prune"], simplified: null },
    thumbnail: true,
    ...patch,
  };
}

export function detailFixture(patch: Partial<AssetDetailData> = {}): AssetDetailData {
  return { asset: assetFixture(), versions: [versionFixture()], attachments: [], ...patch };
}

/** Item daftar Gudang: aset + ringkasan versi terkini + progres build. */
export function listItemFixture(patch: Partial<AssetListItemData> = {}): AssetListItemData {
  return { ...assetFixture(), current: null, versionCount: 0, progress: null, ...patch };
}

/** Respons `GET /api/assets`; `total` bawaan = jumlah item. */
export function listFixture(items: readonly AssetListItemData[], total = items.length): AssetListData {
  return { assets: [...items], total };
}
