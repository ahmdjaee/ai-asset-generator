/**
 * Ekspor dari build sungguhan (Docker + pustaka material + Chromium):
 * - Unity: GLB dari Blender lolos validator tanpa ekstensi kompresi, tekstur PNG/JPEG;
 * - Sumber: `.blend` asli ada di ZIP, dan skrip dari ZIP dijalankan ulang di container menghasilkan jumlah segitiga
 *   yang sama (bentuk dasar dan aset final).
 * Butuh pustaka material (`bun run textures:sync`).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { unzipSync } from "fflate";
import { loadConfig } from "../../../server/config.ts";
import { type DatabaseHandle, openDatabase } from "../../../server/db/client.ts";
import { insertAsset } from "../../../server/db/repos/assets.ts";
import { insertVersion } from "../../../server/db/repos/versions.ts";
import { HeavyLane } from "../../../server/jobs/heavy-lane.ts";
import { readGlb } from "../../../server/pipeline/io.ts";
import { UNITY_BLOCKED_EXTENSIONS } from "../../../server/pipeline/unity.ts";
import { validateGlb } from "../../../server/pipeline/validate.ts";
import { Renderer } from "../../../server/render/renderer.ts";
import { RUNTIME_DIR } from "../../../server/runtime/image.ts";
import { assetDirFor } from "../../../server/services/asset-queries.ts";
import {
  type BuildOutcome,
  type BuildVersionOptions,
  buildBaseVersion,
  buildTexturedVersion,
  shapeOf,
} from "../../../server/services/build-version.ts";
import { ExportService } from "../../../server/services/exports.ts";
import { listVersions, versionDir } from "../../../server/services/versions.ts";
import { DEFAULT_TIERS } from "../../../shared/limits.ts";
import { ENABLED, IT_OWNER, JOBS_ROOT, leftoverJobContainers, nextJobId, requireImage } from "./helpers.ts";

const MATERIALS_DIR = join(loadConfig().dataDir, "library", "materials");
const ASSET_ID = "ekspor-it";

type Built = Extract<BuildOutcome, { ok: true }>;

function ok(outcome: BuildOutcome): Built {
  if (!outcome.ok) throw new Error(`${outcome.code}: ${outcome.message}\n${outcome.detail ?? ""}`);
  return outcome;
}

describe.skipIf(!ENABLED)("ekspor dari build sungguhan", () => {
  const renderer = new Renderer();
  const lane = new HeavyLane();
  let image = "";
  let dataDir = "";
  let handle: DatabaseHandle;
  let exports: ExportService;
  let base: Built;
  let textured: Built;

  function options(assetDir: string, scriptPath: string): BuildVersionOptions {
    return {
      jobId: nextJobId("ekspor"),
      scriptPath,
      assetDir,
      jobsRoot: JOBS_ROOT,
      image,
      owner: IT_OWNER,
      tierId: "sedang",
      lane,
      renderer,
    };
  }

  function record(outcome: Built, stage: "base" | "textured"): void {
    insertVersion(handle.db, {
      assetId: ASSET_ID,
      n: outcome.manifest.version,
      stage,
      stats: outcome.stats,
      budget: outcome.budget,
      manifest: outcome.manifest,
      createdAt: Date.UTC(2026, 10, 14),
    });
  }

  /** ZIP Sumber → folder sementara; hasil: path tiap file menurut nama di dalam ZIP. */
  async function unpackSource(version: number): Promise<Record<string, string>> {
    const served = await exports.file(ASSET_ID, version, "source");
    const target = await mkdtemp(join(dataDir, "unpack-"));
    const paths: Record<string, string> = {};
    for (const [name, data] of Object.entries(unzipSync(new Uint8Array(await readFile(served.path))))) {
      const path = join(target, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
      paths[name.slice(name.indexOf("/") + 1)] = path;
    }
    return paths;
  }

  beforeAll(async () => {
    image = await requireImage();
    if ((await stat(join(MATERIALS_DIR, "catalog.json")).catch(() => null)) === null) {
      throw new Error("Pustaka material belum ada: jalankan `bun run textures:sync` dulu.");
    }
    dataDir = await mkdtemp(join(JOBS_ROOT, "..", "export-it-"));
    handle = openDatabase(":memory:");
    insertAsset(handle.db, {
      id: ASSET_ID,
      name: "Peti Ekspor",
      prompt: "peti kayu",
      tierId: "sedang",
      tier: DEFAULT_TIERS.sedang,
      now: 1,
    });
    exports = new ExportService({ db: handle.db, dataDir });
    const assetDir = assetDirFor(dataDir, ASSET_ID);
    base = ok(await buildBaseVersion(options(assetDir, join(RUNTIME_DIR, "samples", "peti.py"))));
    record(base, "base");
    textured = ok(
      await buildTexturedVersion({
        ...options(assetDir, join(RUNTIME_DIR, "samples", "textured", "peti.py")),
        baseVersion: base.manifest.version,
        baseScriptPath: join(versionDir(assetDir, base.manifest.version), "script.py"),
        baseShape: shapeOf(base.stats),
        materialsDir: MATERIALS_DIR,
      }),
    );
    record(textured, "textured");
  }, 900_000);

  afterAll(async () => {
    await renderer.close();
    handle.close();
    for (const dir of [assetDirFor(dataDir, ASSET_ID), join(dataDir, "ulang")]) {
      for (const version of await listVersions(dir).catch(() => []))
        await chmod(versionDir(dir, version), 0o755);
    }
    await rm(dataDir, { recursive: true, force: true });
    expect(await leftoverJobContainers()).toEqual([]);
  });

  test("Unity: bentuk dasar dan aset final lolos validator tanpa ekstensi kompresi, tekstur PNG/JPEG", async () => {
    for (const outcome of [base, textured]) {
      const glb = new Uint8Array(
        await readFile((await exports.file(ASSET_ID, outcome.manifest.version, "unity")).path),
      );
      expect((await validateGlb(glb)).errors).toBe(0);
      const root = (await readGlb(glb)).getRoot();
      const blocked = root
        .listExtensionsUsed()
        .filter((extension) => UNITY_BLOCKED_EXTENSIONS.has(extension.extensionName));
      expect(blocked).toEqual([]);
      for (const texture of root.listTextures())
        expect(["image/png", "image/jpeg"]).toContain(texture.getMimeType());
      expect(root.listTextures().length).toBe(outcome === textured ? outcome.stats.textures.length : 0);
    }
  }, 120_000);

  test("Sumber: .blend asli, dan skrip bentuk dasar dijalankan ulang → jumlah segitiga sama", async () => {
    const files = await unpackSource(base.manifest.version);
    expect(Object.keys(files).sort()).toEqual(["README.md", "scene.blend", "script.py", "stats.json"]);
    const blend = new Uint8Array(await readFile(files["scene.blend"] ?? ""));
    expect([...blend.subarray(0, 4)]).toEqual([0x28, 0xb5, 0x2f, 0xfd]);
    const again = ok(await buildBaseVersion(options(join(dataDir, "ulang"), files["script.py"] ?? "")));
    expect(again.stats.triangles).toBe(base.stats.triangles);
  }, 300_000);

  test("Sumber aset final: tekstur PNG, dan script.py + base.py dijalankan ulang → jumlah segitiga sama", async () => {
    const files = await unpackSource(textured.manifest.version);
    const textures = Object.keys(files).filter((name) => name.startsWith("textures/"));
    expect(textures.length).toBe(textured.stats.textures.length);
    for (const name of textures) expect(name.endsWith(".png")).toBe(true);
    const ulang = join(dataDir, "ulang");
    const again = ok(
      await buildTexturedVersion({
        ...options(ulang, files["script.py"] ?? ""),
        baseVersion: base.manifest.version,
        baseScriptPath: files["base.py"] ?? "",
        baseShape: shapeOf(base.stats),
        materialsDir: MATERIALS_DIR,
      }),
    );
    expect(again.stats.triangles).toBe(textured.stats.triangles);
    expect(await readdir(versionDir(ulang, again.manifest.version))).toContain("scene.blend");
  }, 900_000);
});
