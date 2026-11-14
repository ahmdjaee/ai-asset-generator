import { describe, expect, test } from "bun:test";
import { lightPosition, SCENE_LIGHTING } from "./scene.ts";

describe("lampu adegan", () => {
  test("posisi lampu = pusat + arah × radius × faktor jarak", () => {
    expect(lightPosition([1, 2, 3], 0.5, [-1.2, 2, 1.4])).toEqual([1 - 1.2 * 2, 2 + 2 * 2, 3 + 1.4 * 2]);
  });

  test("lampu utama dari kiri-atas-depan, pengisi dari kanan-belakang", () => {
    const [kx, ky, kz] = SCENE_LIGHTING.key.direction;
    const [fx, , fz] = SCENE_LIGHTING.fill.direction;
    expect(kx < 0 && ky > 0 && kz > 0).toBe(true);
    expect(fx > 0 && fz < 0).toBe(true);
    expect(SCENE_LIGHTING.key.intensity).toBeGreaterThan(SCENE_LIGHTING.fill.intensity);
  });
});
