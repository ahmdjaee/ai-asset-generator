/** Katalog pustaka material CC0 lokal (`data/library/materials/catalog.json`), hasil `bun run textures:sync`. */
import { z } from "zod";

export const MATERIAL_CATEGORIES = [
  "wood",
  "metal",
  "stone",
  "fabric",
  "leather",
  "plastic",
  "ground",
  "misc",
] as const;
export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number];

/** Map PBR yang disimpan; nama file `<map>.jpg`. Normal memakai konvensi OpenGL (+Y), sama seperti glTF. */
export const MATERIAL_MAPS = ["color", "normal", "roughness", "ao", "metalness"] as const;
export type MaterialMap = (typeof MATERIAL_MAPS)[number];

export const MATERIAL_RESOLUTIONS = ["1k", "2k"] as const;
export type MaterialResolution = (typeof MATERIAL_RESOLUTIONS)[number];

export const MATERIAL_ID = /^[A-Za-z][A-Za-z0-9]{1,40}$/;

export const CatalogMaterial = z.object({
  id: z.string().regex(MATERIAL_ID),
  name: z.string().min(1).max(100),
  category: z.enum(MATERIAL_CATEGORIES),
  tags: z.array(z.string().max(40)).max(40),
  maps: z.array(z.enum(MATERIAL_MAPS)).min(1),
  resolutions: z.array(z.enum(MATERIAL_RESOLUTIONS)).min(1),
  license: z.literal("CC0-1.0"),
  sourceUrl: z.url(),
});
export type CatalogMaterial = z.infer<typeof CatalogMaterial>;

export const MaterialCatalog = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  source: z.literal("ambientCG"),
  materials: z.array(CatalogMaterial),
});
export type MaterialCatalog = z.infer<typeof MaterialCatalog>;
