import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { TURNTABLE_FRAME_PX, TURNTABLE_FRAMES, WEBP_MAX_SIDE_PX } from "../../shared/limits.ts";
import { composeTurntable } from "./turntable.ts";

type Size = Readonly<{ width: number; height: number }>;

/** Frame uji: kotak buram yang bergeser 15 px per frame di atas latar transparan. */
async function frame(index: number, size: Size = TURNTABLE_FRAME_PX): Promise<Uint8Array> {
  const square = await sharp({
    create: { width: 40, height: 40, channels: 4, background: { r: 200, g: 120, b: 40, alpha: 1 } },
  })
    .png()
    .toBuffer();
  const png = await sharp({ create: { ...size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: square, left: 10 + index * 15, top: 100 }])
    .png()
    .toBuffer();
  return new Uint8Array(png);
}

describe("composeTurntable", () => {
  test("strip: frame berjajar mendatar, WebP dengan alpha; thumbnail = frame pertama", async () => {
    const frames = await Promise.all(Array.from({ length: TURNTABLE_FRAMES }, (_, index) => frame(index)));
    const { strip, thumb } = await composeTurntable(frames);
    const { width, height } = TURNTABLE_FRAME_PX;
    const stripMeta = await sharp(strip).metadata();
    expect([stripMeta.format, stripMeta.width, stripMeta.height, stripMeta.hasAlpha]).toEqual([
      "webp",
      width * TURNTABLE_FRAMES,
      height,
      true,
    ]);
    expect(width * TURNTABLE_FRAMES).toBeLessThanOrEqual(WEBP_MAX_SIDE_PX);
    const thumbMeta = await sharp(thumb).metadata();
    expect([thumbMeta.format, thumbMeta.width, thumbMeta.height, thumbMeta.hasAlpha]).toEqual([
      "webp",
      width,
      height,
      true,
    ]);

    const raw = await sharp(strip).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = (x: number, y: number) => raw.data[(y * raw.info.width + x) * 4 + 3] ?? -1;
    // Frame ke-3 dimulai di x = 3 × lebar frame; kotaknya di x 10 + 3 × 15 dari tepi frame itu.
    expect(alpha(3 * width + 10 + 45 + 20, 120)).toBeGreaterThan(200);
    expect(alpha(3 * width + 5, 5)).toBe(0);
    const thumbRaw = await sharp(thumb).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(thumbRaw.data[(120 * width + 30) * 4 + 3]).toBeGreaterThan(200);
  });

  test("tanpa frame, ukuran frame salah, atau strip melewati batas WebP ditolak", async () => {
    await expect(composeTurntable([])).rejects.toThrow(/minimal satu frame/);
    await expect(composeTurntable([await frame(0, { width: 100, height: 100 })])).rejects.toThrow(
      /seharusnya/,
    );
    const tooMany = Math.floor(WEBP_MAX_SIDE_PX / TURNTABLE_FRAME_PX.width) + 1;
    const one = await frame(0);
    await expect(composeTurntable(Array.from({ length: tooMany }, () => one))).rejects.toThrow(/batas WebP/);
  });
});
