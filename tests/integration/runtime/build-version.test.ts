/** Build versi lengkap (runtime → pipeline → render → versi) dengan Docker dan Chromium sungguhan. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const FIXTURES_GLB = join(import.meta.dir, "../../fixtures/glb");

import { HeavyLane, JobCancelledError } from "../../../server/jobs/heavy-lane.ts";
import { Renderer } from "../../../server/render/renderer.ts";
import { RUNTIME_DIR } from "../../../server/runtime/image.ts";
import { type BuildVersionOptions, buildBaseVersion } from "../../../server/services/build-version.ts";
import { listVersions, verifyVersion, versionDir } from "../../../server/services/versions.ts";
import {
  ENABLED,
  IT_OWNER,
  JOBS_ROOT,
  leftoverJobContainers,
  nextJobId,
  requireImage,
  SCRIPTS_DIR,
} from "./helpers.ts";

describe.skipIf(!ENABLED)("buildBaseVersion", () => {
  const renderer = new Renderer();
  const lane = new HeavyLane();
  let image = "";
  let assetDir = "";

  beforeAll(async () => {
    image = await requireImage();
    assetDir = await mkdtemp(join(JOBS_ROOT, "..", "asset-it-"));
  });

  afterAll(async () => {
    await renderer.close();
    for (const version of await listVersions(assetDir)) await chmod(versionDir(assetDir, version), 0o755);
    await rm(assetDir, { recursive: true, force: true });
    expect(await leftoverJobContainers()).toEqual([]);
  });

  function options(scriptPath: string, extra: Partial<BuildVersionOptions> = {}): BuildVersionOptions {
    return {
      jobId: nextJobId("build"),
      scriptPath,
      assetDir,
      jobsRoot: JOBS_ROOT,
      image,
      owner: IT_OWNER,
      tierId: "sedang",
      lane,
      renderer,
      ...extra,
    };
  }

  test("skrip contoh → v1 read-only dengan manifest dan contact sheet", async () => {
    const outcome = await buildBaseVersion(options(join(RUNTIME_DIR, "samples", "peti.py")));
    if (!outcome.ok) throw new Error(`${outcome.code}: ${outcome.message}\n${outcome.detail ?? ""}`);
    expect(outcome.manifest.version).toBe(1);
    expect(outcome.manifest.files.map((file) => file.name)).toEqual([
      "base.glb",
      "web.glb",
      "script.py",
      "scene.blend",
      "stats.json",
    ]);
    // `.blend` terkompresi zstd (Blender ≥ 3.0) untuk preset ekspor Sumber.
    const blend = new Uint8Array(await readFile(join(versionDir(assetDir, 1), "scene.blend")));
    expect([...blend.subarray(0, 4)]).toEqual([0x28, 0xb5, 0x2f, 0xfd]);
    expect(outcome.validation.errors).toBe(0);
    expect(outcome.budget.ok).toBe(true);
    expect(outcome.stats.triangles).toBeGreaterThan(0);
    expect((await stat(versionDir(assetDir, 1))).mode & 0o777).toBe(0o555);
    expect(await verifyVersion(assetDir, 1)).toEqual({ ok: true, mismatched: [] });
    expect((await stat(outcome.contactSheetPath)).size).toBeGreaterThan(10_000);
  }, 120_000);

  test("lampiran di refs/ dipasang read-only di /refs dan bisa diimpor skrip", async () => {
    await mkdir(join(assetDir, "refs"), { recursive: true });
    await copyFile(join(FIXTURES_GLB, "peti.glb"), join(assetDir, "refs", "ref.glb"));
    const outcome = await buildBaseVersion(options(join(SCRIPTS_DIR, "import_ref.py")));
    if (!outcome.ok) throw new Error(`${outcome.code}: ${outcome.message}\n${outcome.detail ?? ""}`);
    expect(outcome.stats.triangles).toBeGreaterThan(0);
    expect(await readdir(join(assetDir, "refs"))).toEqual(["ref.glb"]);
  }, 120_000);

  test("skrip gagal → SCRIPT_ERROR dengan traceback, tanpa versi baru", async () => {
    const before = await listVersions(assetDir);
    const outcome = await buildBaseVersion(options(join(SCRIPTS_DIR, "broken_script.py")));
    expect(outcome).toMatchObject({ ok: false, code: "SCRIPT_ERROR" });
    if (!outcome.ok) expect(outcome.detail).toContain("ValueError: ukuran kaki tidak valid");
    expect(await listVersions(assetDir)).toEqual(before);
  }, 120_000);

  test("build dibatalkan saat berjalan → container di-kill, tanpa versi baru", async () => {
    const before = await listVersions(assetDir);
    const controller = new AbortController();
    const unsubscribe = lane.on((event) => {
      if (event.type === "progress") controller.abort();
    });
    try {
      await expect(
        buildBaseVersion(options(join(RUNTIME_DIR, "samples", "laras.py"), { signal: controller.signal })),
      ).rejects.toBeInstanceOf(JobCancelledError);
    } finally {
      unsubscribe();
    }
    expect(await listVersions(assetDir)).toEqual(before);
    expect(await leftoverJobContainers()).toEqual([]);
  }, 120_000);
});
