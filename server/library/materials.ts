/**
 * Pustaka material CC0 lokal (`data/library/materials`, hasil `bun run textures:sync`):
 * katalog (dibaca ulang bila file berubah), pencarian, dan lembar contoh (preview) untuk Claude.
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import {
  type CatalogMaterial,
  MATERIAL_ID,
  MaterialCatalog,
  type MaterialCategory,
} from "../../shared/material-catalog.ts";

export const SWATCH_PX = 160;
const SWATCH_COLUMNS = 4;
const LABEL_PX = 22;
/** Batas hasil pencarian dan jumlah contoh di satu lembar. */
export const MAX_RESULTS = 12;

export type MaterialQuery = Readonly<{
  query?: string;
  category?: MaterialCategory;
  limit?: number;
}>;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1);
}

/** Cocok bila salah satu awalan yang lain ("rust" ~ "rusty", "plank" ~ "planks"), minimal 3 huruf. */
function matches(word: string, term: string): boolean {
  if (word.startsWith(term)) return true;
  return word.length >= 3 && term.startsWith(word);
}

/** Pencarian sederhana: setiap kata kueri dicocokkan ke id, nama, kategori, dan tag. Murni. */
export function searchCatalog(
  materials: readonly CatalogMaterial[],
  query: MaterialQuery,
): CatalogMaterial[] {
  const terms = words(query.query ?? "");
  const limit = Math.min(Math.max(query.limit ?? MAX_RESULTS, 1), MAX_RESULTS);
  const scored = materials
    .filter((material) => query.category === undefined || material.category === query.category)
    .map((material) => {
      const haystack = new Set([
        ...words(material.id),
        ...words(material.name),
        material.category,
        ...material.tags.flatMap(words),
      ]);
      const score = terms.reduce(
        (total, term) => total + ([...haystack].some((word) => matches(word, term)) ? 1 : 0),
        0,
      );
      return { material, score };
    })
    .filter((entry) => terms.length === 0 || entry.score > 0)
    .sort((a, b) => b.score - a.score || a.material.id.localeCompare(b.material.id));
  return scored.slice(0, limit).map((entry) => entry.material);
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export class MaterialLibrary {
  readonly dir: string;
  #cache: { mtimeMs: number; catalog: MaterialCatalog } | null = null;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** Katalog, atau `null` bila pustaka belum disinkronkan. */
  async catalog(): Promise<MaterialCatalog | null> {
    const path = join(this.dir, "catalog.json");
    const info = await stat(path).catch(() => null);
    if (info === null) return null;
    if (this.#cache?.mtimeMs === info.mtimeMs) return this.#cache.catalog;
    const catalog = MaterialCatalog.parse(JSON.parse(await readFile(path, "utf8")));
    this.#cache = { mtimeMs: info.mtimeMs, catalog };
    return catalog;
  }

  /** Lembar contoh PNG (4 kolom, label id) untuk material yang ditemukan. */
  async swatches(materials: readonly CatalogMaterial[]): Promise<Uint8Array | null> {
    const shown = materials.slice(0, MAX_RESULTS).filter((material) => MATERIAL_ID.test(material.id));
    if (shown.length === 0) return null;
    const columns = Math.min(SWATCH_COLUMNS, shown.length);
    const rows = Math.ceil(shown.length / columns);
    const cell = SWATCH_PX + LABEL_PX;
    const tiles = await Promise.all(
      shown.map(async (material, index) => {
        const preview = await readFile(join(this.dir, material.id, "preview.jpg")).catch(() => null);
        const image =
          preview === null
            ? await sharp({
                create: { width: SWATCH_PX, height: SWATCH_PX, channels: 3, background: "#444" },
              })
                .png()
                .toBuffer()
            : await sharp(preview).resize(SWATCH_PX, SWATCH_PX).png().toBuffer();
        const label = Buffer.from(
          `<svg width="${SWATCH_PX}" height="${LABEL_PX}"><rect width="100%" height="100%" fill="#1b1b1f"/>` +
            `<text x="6" y="16" font-family="sans-serif" font-size="13" fill="#f2f2f2">${escapeXml(material.id)}</text></svg>`,
        );
        const left = (index % columns) * SWATCH_PX;
        const top = Math.floor(index / columns) * cell;
        return [
          { input: image, left, top },
          { input: label, left, top: top + SWATCH_PX },
        ];
      }),
    );
    const sheet = await sharp({
      create: { width: columns * SWATCH_PX, height: rows * cell, channels: 3, background: "#1b1b1f" },
    })
      .composite(tiles.flat())
      .png()
      .toBuffer();
    return new Uint8Array(sheet);
  }
}
