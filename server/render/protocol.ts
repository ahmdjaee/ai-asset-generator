/**
 * Kontrak antara renderer (server) dan halaman render di Chromium. Hasil dari halaman divalidasi zod karena berasal
 * dari proses lain.
 */
import { z } from "zod";

export const RENDER_MODES = ["clay", "wireframe", "texture"] as const;
export type RenderMode = (typeof RENDER_MODES)[number];

/**
 * Sudut kamera. Konvensi sama dengan viewport Blender: depan = kamera di +Z glTF (−Y Blender), kanan = kamera di +X.
 * "kiri" dan "kanan" dilihat dari kamera.
 */
export const RENDER_VIEWS = ["front", "back", "left", "right", "top", "three_quarter"] as const;
export type RenderView = (typeof RENDER_VIEWS)[number];

export const VIEW_LABELS: Readonly<Record<RenderView, string>> = {
  front: "Depan",
  back: "Belakang",
  left: "Kiri",
  right: "Kanan",
  top: "Atas",
  three_quarter: "3/4",
};

export type PageRenderRequest = Readonly<{
  modelUrl: string;
  mode: RenderMode;
  views: readonly RenderView[];
  tilePx: number;
  labels: Readonly<Record<RenderView, string>>;
}>;

export const PageTile = z.object({
  view: z.enum(RENDER_VIEWS),
  /** PNG sebagai data URL. */
  png: z.string().startsWith("data:image/png;base64,"),
  /** Bagian gambar yang tertutup objek (0–1), dari pass siluet tanpa grid. */
  coverage: z.number().min(0).max(1),
  /** Titik berat siluet, 0–1 dari kiri-atas; null bila objek tidak tampak. */
  centroid: z.tuple([z.number(), z.number()]).nullable(),
});
export type PageTile = z.infer<typeof PageTile>;

export const PageRenderResult = z.object({
  tiles: z.array(PageTile),
  /** Ukuran grid lantai (m per kotak) yang dipakai. */
  gridCellM: z.number().positive(),
  triangles: z.number().int().nonnegative(),
});
export type PageRenderResult = z.infer<typeof PageRenderResult>;

/** Permintaan turntable: model diputar di sumbu tegak, kamera dan lampu tetap (seperti meja putar). */
export type PageTurntableRequest = Readonly<{
  modelUrl: string;
  mode: "clay" | "texture";
  frames: number;
  width: number;
  height: number;
}>;

export const PageTurntableResult = z.object({
  /** PNG RGBA (latar transparan) per frame, berurutan searah putaran. */
  frames: z.array(z.string().startsWith("data:image/png;base64,")).min(1),
});
export type PageTurntableResult = z.infer<typeof PageTurntableResult>;

/** Objek GPU yang masih dipegang halaman render (`renderer.info.memory`). Halaman dipakai ulang antar-render. */
export const GpuMemory = z.object({
  geometries: z.number().int().nonnegative(),
  textures: z.number().int().nonnegative(),
});
export type GpuMemory = z.infer<typeof GpuMemory>;
