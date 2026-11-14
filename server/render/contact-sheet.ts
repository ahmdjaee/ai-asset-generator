/** Contact sheet: tile sudut disusun dalam grid (maks. 3 kolom) dengan sharp; sisi terpanjang ≤ 1024 px. */
import sharp from "sharp";
import { CONTACT_SHEET_GAP_PX, CONTACT_SHEET_MAX_PX } from "../../shared/limits.ts";

const BACKGROUND = "#111113";
const MAX_COLUMNS = 3;

export type SheetTile = Readonly<{ png: Uint8Array; size: number }>;
export type ContactSheet = Readonly<{ png: Uint8Array; width: number; height: number }>;

export async function composeContactSheet(tiles: readonly SheetTile[]): Promise<ContactSheet> {
  const first = tiles[0];
  if (first === undefined) throw new Error("Contact sheet butuh minimal satu tile");
  const size = first.size;
  const columns = Math.min(MAX_COLUMNS, tiles.length);
  const rows = Math.ceil(tiles.length / columns);
  const gap = CONTACT_SHEET_GAP_PX;
  const width = columns * size + (columns + 1) * gap;
  const height = rows * size + (rows + 1) * gap;

  const composed = await sharp({ create: { width, height, channels: 3, background: BACKGROUND } })
    .composite(
      tiles.map((tile, index) => ({
        input: Buffer.from(tile.png),
        left: gap + (index % columns) * (size + gap),
        top: gap + Math.floor(index / columns) * (size + gap),
      })),
    )
    .png()
    .toBuffer();

  const longest = Math.max(width, height);
  if (longest <= CONTACT_SHEET_MAX_PX) return { png: new Uint8Array(composed), width, height };
  const scale = CONTACT_SHEET_MAX_PX / longest;
  const resized = await sharp(composed)
    .resize(Math.round(width * scale), Math.round(height * scale))
    .png()
    .toBuffer({ resolveWithObject: true });
  return { png: new Uint8Array(resized.data), width: resized.info.width, height: resized.info.height };
}
