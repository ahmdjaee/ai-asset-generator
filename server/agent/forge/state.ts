/**
 * Identitas aset untuk tool `forge`. Status aset (tahap, brief, jatah build, versi yang disetujui) TIDAK disimpan di
 * sini: tool membaca dan mengubahnya lewat `ForgeStore` (database + `transition()`, PLAN Lampiran C).
 */
import type { AssetStateStore } from "../../domain/status.ts";
import type { AssetWorkspace, VersionEntry } from "../../services/asset-store.ts";

export type ForgeAsset = AssetWorkspace;

/** Status aset + indeks versi; diimplementasikan `AssetStore`. */
export type ForgeStore = AssetStateStore & Readonly<{ recordVersion(entry: VersionEntry): void }>;
