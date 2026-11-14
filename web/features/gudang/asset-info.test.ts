import { describe, expect, test } from "bun:test";
import { listItemFixture } from "@/test-assets.ts";
import { assetInfo, assetProgress } from "./asset-info.ts";

describe("info kartu Gudang", () => {
  test("versi terkini: segitiga ringkas + ukuran web.glb", () => {
    const asset = listItemFixture({
      current: { n: 2, stage: "textured", triangles: 3388, webBytes: 612_000, thumbnail: true },
    });
    expect(assetInfo(asset)).toBe("3,4k segitiga · 612 KB");
    expect(assetProgress(asset)).toBeUndefined();
  });

  test("versi tanpa web.glb: hanya segitiga", () => {
    expect(
      assetInfo(
        listItemFixture({
          current: { n: 1, stage: "base", triangles: 950, webBytes: null, thumbnail: true },
        }),
      ),
    ).toBe("950 segitiga");
  });

  test("build berjalan: tahap dan persen, bar progres 0..1", () => {
    const asset = listItemFixture({
      runState: "running",
      current: { n: 1, stage: "base", triangles: 950, webBytes: 1000, thumbnail: true },
      progress: { stage: "textured", pct: 62 },
    });
    expect(assetInfo(asset)).toBe("Tahap 2 · 62%");
    expect(assetProgress(asset)).toBe(0.62);
  });

  test("belum ada versi", () => {
    expect(assetInfo(listItemFixture())).toBe("Belum ada versi");
  });
});
