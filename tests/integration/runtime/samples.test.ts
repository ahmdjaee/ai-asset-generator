/** Skrip contoh berjalan lewat runner sungguhan dan menghasilkan GLB valid. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { removeOrphanJobs } from "../../../server/runtime/docker.ts";
import { RUNTIME_DIR } from "../../../server/runtime/image.ts";
import { BASE_JOB_COMMAND } from "../../../server/runtime/job-dir.ts";
import { collectOutputs } from "../../../server/runtime/outputs.ts";
import { BASE_JOB_LIMITS, BASE_OUTPUT_MAX_BYTES } from "../../../shared/limits.ts";
import { cleanup, ENABLED, IT_OWNER, leftoverJobContainers, requireImage, runScript } from "./helpers.ts";

const Stats = z.object({
  objects: z.number().int().positive(),
  vertices: z.number().int().positive(),
  triangles: z.number().int().positive(),
  materials: z.literal(0),
  bbox: z.object({
    min: z.array(z.number()).length(3),
    max: z.array(z.number()).length(3),
    size: z.array(z.number()),
  }),
});

/** Bagian JSON dari GLB (chunk pertama). */
async function glbJson(path: string): Promise<Record<string, unknown>> {
  const bytes = new Uint8Array(await readFile(path));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("glTF");
  const length = view.getUint32(12, true);
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
  return z.record(z.string(), z.unknown()).parse(parsed);
}

const SAMPLES = [
  { name: "peti", height: 0.54 },
  { name: "kursi", height: 0.915 },
  { name: "laras", height: 0.9 },
  { name: "pohon", height: 2.019 },
  { name: "makhluk", height: 0.66 },
];

describe.skipIf(!ENABLED)("skrip contoh", () => {
  let image = "";

  beforeAll(async () => {
    image = await requireImage();
  });

  afterAll(async () => {
    expect(await leftoverJobContainers()).toEqual([]);
  });

  test.each(SAMPLES)(
    "$name → GLB tanpa material, origin di dasar-tengah",
    async ({ name, height }) => {
      const run = await runScript(image, join(RUNTIME_DIR, "samples", `${name}.py`), {
        limits: BASE_JOB_LIMITS,
        command: BASE_JOB_COMMAND,
      });
      try {
        expect(run.result.exitCode, run.result.stderrTail).toBe(0);
        expect(run.result.progress.at(-1)).toEqual({ type: "progress", step: "selesai", pct: 100 });
        expect(run.result.peakMemBytes).toBeGreaterThan(0);
        expect(run.result.peakMemBytes).toBeLessThan(BASE_JOB_LIMITS.memoryBytes);

        const scan = await collectOutputs(run.dir.outputDir, BASE_OUTPUT_MAX_BYTES);
        expect(scan.rejected).toEqual([]);
        expect(scan.accepted.map((file) => file.name).sort()).toEqual([
          "base.glb",
          "scene.blend",
          "stats.json",
        ]);

        const stats = Stats.parse(JSON.parse(await readFile(join(run.dir.outputDir, "stats.json"), "utf8")));
        expect(stats.bbox.min[2]).toBeCloseTo(0, 5);
        expect(stats.bbox.size[2]).toBeCloseTo(height, 2);
        expect(((stats.bbox.min[0] ?? 0) + (stats.bbox.max[0] ?? 0)) / 2).toBeCloseTo(0, 5);

        const gltf = await glbJson(join(run.dir.outputDir, "base.glb"));
        expect(gltf.materials).toBeUndefined();
        expect(gltf.extensionsUsed).toBeUndefined();
      } finally {
        await cleanup(run);
      }
    },
    120_000,
  );

  test("removeOrphanJobs tidak menemukan container setelah job selesai", async () => {
    expect(await removeOrphanJobs(IT_OWNER)).toBe(0);
  });
});
