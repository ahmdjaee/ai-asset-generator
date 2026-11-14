/** Strip turntable dan thumbnail (WebP berlatar transparan) dari frame PNG halaman render. */
import sharp from "sharp";
import { TURNTABLE_FRAME_PX, WEBP_MAX_SIDE_PX } from "../../shared/limits.ts";

export type TurntableImages = Readonly<{ thumb: Uint8Array; strip: Uint8Array }>;

/** Alpha tanpa kompresi lossy: tepi objek dan gradasi bayangan tidak bergerigi. */
const WEBP = { quality: 82, alphaQuality: 100, effort: 4 } as const;

export async function composeTurntable(frames: readonly Uint8Array[]): Promise<TurntableImages> {
  const { width, height } = TURNTABLE_FRAME_PX;
  const first = frames[0];
  if (first === undefined) throw new Error("Turntable butuh minimal satu frame");
  const stripWidth = width * frames.length;
  if (stripWidth > WEBP_MAX_SIDE_PX) throw new Error(`Strip turntable ${stripWidth} px melewati batas WebP`);
  for (const frame of frames) {
    const meta = await sharp(frame).metadata();
    if (meta.width !== width || meta.height !== height) {
      throw new Error(`Frame turntable ${meta.width}×${meta.height}, seharusnya ${width}×${height}`);
    }
  }
  const strip = await sharp({
    create: { width: stripWidth, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(frames.map((png, index) => ({ input: Buffer.from(png), left: index * width, top: 0 })))
    .webp(WEBP)
    .toBuffer();
  const thumb = await sharp(first).webp(WEBP).toBuffer();
  return { thumb: new Uint8Array(thumb), strip: new Uint8Array(strip) };
}
