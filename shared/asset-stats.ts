/** Statistik aset GLB. Dipakai pipeline (server), hasil tool `forge`, dan UI. */
import { z } from "zod";

export const TEXTURE_SLOTS = ["baseColor", "normal", "orm", "emissive", "other"] as const;
export type TextureSlot = (typeof TEXTURE_SLOTS)[number];

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const AssetStats = z.object({
  triangles: z.number().int().nonnegative(),
  vertices: z.number().int().nonnegative(),
  /** Jumlah material yang dipakai primitive (bukan yang sekadar ada di file). */
  materials: z.number().int().nonnegative(),
  /** Jumlah primitive = perkiraan draw call. */
  drawCalls: z.number().int().nonnegative(),
  textures: z.array(
    z.object({
      slot: z.enum(TEXTURE_SLOTS),
      width: z.number().int().nonnegative(),
      height: z.number().int().nonnegative(),
      mimeType: z.string(),
    }),
  ),
  /** Bounding box dalam meter, sumbu glTF (+Y atas). */
  bbox: z.object({ min: Vec3, max: Vec3, size: Vec3 }),
  /** Ukuran file GLB tanpa kompresi (byte). */
  bytes: z.number().int().nonnegative(),
});
export type AssetStats = z.infer<typeof AssetStats>;
