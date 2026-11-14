/**
 * Build bertekstur sungguhan (Docker + pustaka material + Chromium) per tier: ukuran tekstur, 1 material atlas,
 * ukuran `web.glb`, waktu dan RAM puncak Maksimal, gerbang bentuk, dan tidak ada container tersisa.
 * Butuh pustaka material (`bun run textures:sync`).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { loadConfig } from "../../../server/config.ts";
import { HeavyLane } from "../../../server/jobs/heavy-lane.ts";
import { Renderer } from "../../../server/render/renderer.ts";
import { RUNTIME_DIR } from "../../../server/runtime/image.ts";
import {
  type BuildVersionOptions,
  buildBaseVersion,
  buildTexturedVersion,
  shapeOf,
} from "../../../server/services/build-version.ts";
import { listVersions, versionDir } from "../../../server/services/versions.ts";
import { DEFAULT_TIERS, TIER_IDS, type TierId, texturedJobLimits } from "../../../shared/limits.ts";
import {
  ENABLED,
  IT_OWNER,
  JOBS_ROOT,
  leftoverJobContainers,
  nextJobId,
  requireImage,
  SCRIPTS_DIR,
} from "./helpers.ts";

const MIB = 1024 * 1024;
const MATERIALS_DIR = join(loadConfig().dataDir, "library", "materials");
const BASE_SCRIPT = join(RUNTIME_DIR, "samples", "peti.py");
const TEXTURED_SCRIPT = join(RUNTIME_DIR, "samples", "textured", "peti.py");

describe.skipIf(!ENABLED)("buildTexturedVersion", () => {
  const renderer = new Renderer();
  const lane = new HeavyLane();
  let image = "";
  let assetDir = "";

  beforeAll(async () => {
    image = await requireImage();
    const catalog = await stat(join(MATERIALS_DIR, "catalog.json")).catch(() => null);
    if (catalog === null)
      throw new Error("Pustaka material belum ada: jalankan `bun run textures:sync` dulu.");
    assetDir = await mkdtemp(join(JOBS_ROOT, "..", "asset-tex-it-"));
  });

  afterAll(async () => {
    await renderer.close();
    for (const version of await listVersions(assetDir)) await chmod(versionDir(assetDir, version), 0o755);
    await rm(assetDir, { recursive: true, force: true });
    expect(await leftoverJobContainers()).toEqual([]);
  });

  function options(tierId: TierId, scriptPath: string): BuildVersionOptions {
    return {
      jobId: nextJobId(`tex-${tierId}`),
      scriptPath,
      assetDir,
      jobsRoot: JOBS_ROOT,
      image,
      owner: IT_OWNER,
      tierId,
      lane,
      renderer,
    };
  }

  async function approvedBase(tierId: TierId) {
    const base = await buildBaseVersion(options(tierId, BASE_SCRIPT));
    if (!base.ok) throw new Error(`${base.code}: ${base.message}`);
    const version = base.manifest.version;
    return {
      baseVersion: version,
      baseScriptPath: join(versionDir(assetDir, version), "script.py"),
      baseShape: shapeOf(base.stats),
      materialsDir: MATERIALS_DIR,
    };
  }

  for (const tierId of TIER_IDS) {
    test(`tier ${tierId}: tekstur sesuai tier, 1 material, web.glb ≤ maks, 0 error validator`, async () => {
      const tier = DEFAULT_TIERS[tierId];
      const base = await approvedBase(tierId);
      const outcome = await buildTexturedVersion({ ...options(tierId, TEXTURED_SCRIPT), ...base });
      if (!outcome.ok) throw new Error(`${outcome.code}: ${outcome.message}\n${outcome.detail ?? ""}`);

      expect(outcome.manifest.files.map((file) => file.name)).toEqual([
        "final.glb",
        "web.glb",
        "script.py",
        "base.py",
        "scene.blend",
        "stats.json",
      ]);
      expect(outcome.validation.errors).toBe(0);
      // Tangent ikut diekspor: engine tidak perlu menghitung sendiri (hasil normal map konsisten).
      expect(outcome.validation.messages.map((message) => message.code)).not.toContain(
        "MESH_PRIMITIVE_GENERATED_TANGENT_SPACE",
      );
      expect(outcome.budget.ok).toBe(true);
      expect(outcome.stats.materials).toBe(1);
      const slots = Object.fromEntries(
        outcome.stats.textures.map((t) => [t.slot, Math.max(t.width, t.height)]),
      );
      // Emisi belum di-bake (Tahap 4): slot yang diharapkan = tekstur tier tanpa emissive.
      const { emissive: _emissive, ...expected } = tier.textures;
      expect(slots).toEqual(expected);
      const web = outcome.budget.items.find((item) => item.key === "webBytes");
      expect(web?.value ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(tier.webBytes.max);

      // web.glb: tekstur WebP + kompresi meshopt.
      const io = new NodeIO();
      const json = (await io.readAsJSON(join(versionDir(assetDir, outcome.manifest.version), "web.glb")))
        .json;
      expect(json.extensionsUsed).toContain("EXT_meshopt_compression");
      expect(new Set((json.images ?? []).map((img) => img.mimeType))).toEqual(new Set(["image/webp"]));

      expect(outcome.timings.runtimeMs).toBeLessThanOrEqual(texturedJobLimits(tierId).timeoutMs);
      if (outcome.peakMemBytes !== null) expect(outcome.peakMemBytes).toBeLessThan(2.5 * 1024 * MIB);
      console.log(
        `[${tierId}] runtime ${(outcome.timings.runtimeMs / 1000).toFixed(1)} dtk, RAM puncak ` +
          `${outcome.peakMemBytes === null ? "?" : Math.round(outcome.peakMemBytes / MIB)} MiB, web ${web?.value} B`,
      );
    }, 900_000);
  }

  test("bentuk menyimpang dari bentuk dasar → SHAPE_DRIFT tanpa versi baru", async () => {
    const base = await approvedBase("sedang");
    const before = await listVersions(assetDir);
    const outcome = await buildTexturedVersion({
      ...options("sedang", join(SCRIPTS_DIR, "drift_material.py")),
      ...base,
    });
    expect(outcome).toMatchObject({ ok: false, code: "SHAPE_DRIFT" });
    expect(await listVersions(assetDir)).toEqual(before);
  }, 300_000);
});
