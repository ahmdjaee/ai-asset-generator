import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import sharp from "sharp";
import { DEFAULT_TIERS } from "../../shared/limits.ts";
import { removeTree } from "../../tests/support/api.ts";
import { type DatabaseHandle, openDatabase } from "../db/client.ts";
import { insertAsset, renameAsset, saveAssetState } from "../db/repos/assets.ts";
import { insertVersion } from "../db/repos/versions.ts";
import { INITIAL_STATE } from "../domain/status.ts";
import { readGlb, writeGlb } from "../pipeline/io.ts";
import { processGlb } from "../pipeline/process.ts";
import { gridDocument, texturedDocument } from "../pipeline/test-documents.ts";
import { UNITY_BLOCKED_EXTENSIONS } from "../pipeline/unity.ts";
import { validateGlb } from "../pipeline/validate.ts";
import { assetDirFor } from "./asset-queries.ts";
import { ExportService, sourceExportFile, UNITY_EXPORT_FILE } from "./exports.ts";
import { createVersion } from "./versions.ts";
import { assertZipPath } from "./zip-stream.ts";

const CREATED_AT = Date.UTC(2026, 10, 14);

let dataDir = "";
let handle: DatabaseHandle;
let service: ExportService;
let errors: unknown[];

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "aag-export-"));
  handle = openDatabase(":memory:");
  errors = [];
  service = new ExportService({ db: handle.db, dataDir, onError: (error) => errors.push(error) });
});

afterEach(async () => {
  handle.close();
  await removeTree(dataDir);
});

/** Budget Sedang yang diubah di Pengaturan sebelum aset dibuat (snapshot aset ≠ `DEFAULT_TIERS`). */
const CUSTOM_SEDANG = { ...DEFAULT_TIERS.sedang, textures: { baseColor: 2048, normal: 1024 } };

function addAsset(id: string, name: string, tier = DEFAULT_TIERS.sedang): void {
  insertAsset(handle.db, {
    id,
    name,
    prompt: "peti kayu\nbaris kedua",
    tierId: "sedang",
    tier,
    now: 1,
  });
}

function setCurrent(id: string, version: number): void {
  saveAssetState(handle.db, id, { ...INITIAL_STATE, currentVersion: version }, 2);
}

/** Versi bentuk dasar: GLB tanpa material + `.blend` (isi bebas) + skrip. */
async function addBaseVersion(id: string, n = 1): Promise<void> {
  const processed = await processGlb(await writeGlb(gridDocument(3)), { tierId: "sedang", stage: "base" });
  await addVersion(id, n, "base", processed, [
    { name: "base.glb", data: processed.glb },
    { name: "web.glb", data: processed.web ?? new Uint8Array() },
    { name: "script.py", data: "import assetkit\n" },
    { name: "scene.blend", data: new Uint8Array(4096).fill(7) },
  ]);
}

/** Versi final bertekstur, tanpa `.blend` (seperti versi dari sebelum Tahap 10). */
async function addTexturedVersion(id: string, n = 2): Promise<void> {
  const processed = await processGlb(await writeGlb(await texturedDocument(128)), {
    tierId: "sedang",
    stage: "textured",
  });
  await addVersion(id, n, "textured", processed, [
    { name: "final.glb", data: processed.glb },
    { name: "web.glb", data: processed.web ?? new Uint8Array() },
    { name: "script.py", data: "scene.run_base()\n" },
    { name: "base.py", data: "import assetkit\n" },
  ]);
}

async function addVersion(
  id: string,
  n: number,
  stage: "base" | "textured",
  processed: Awaited<ReturnType<typeof processGlb>>,
  files: Array<{ name: string; data: Uint8Array | string }>,
): Promise<void> {
  const manifest = await createVersion({
    assetDir: assetDirFor(dataDir, id),
    files: [...files, { name: "stats.json", data: JSON.stringify({ stats: processed.stats }) }],
    meta: { stage },
  });
  expect(manifest.version).toBe(n);
  insertVersion(handle.db, {
    assetId: id,
    n,
    stage,
    stats: processed.stats,
    budget: { ok: true },
    manifest,
    createdAt: CREATED_AT,
  });
}

function derived(id: string, version: number, name: string): string {
  return join(assetDirFor(dataDir, id), "derived", `v${version}`, name);
}

async function extensionsOf(glb: Uint8Array): Promise<string[]> {
  return (await readGlb(glb))
    .getRoot()
    .listExtensionsUsed()
    .map((extension) => extension.extensionName);
}

describe("ExportService — satu versi", () => {
  test("Web: web.glb versi apa adanya, nama unduhan aman", async () => {
    addAsset("a1", "Peti Kayu");
    await addBaseVersion("a1");
    const served = await service.file("a1", 1, "web");
    expect([served.contentType, served.downloadName, served.cache]).toEqual([
      "model/gltf-binary",
      "peti-kayu-v1-web.glb",
      "revalidate",
    ]);
    expect(new Uint8Array(await readFile(served.path))).toEqual(
      new Uint8Array(await readFile(join(assetDirFor(dataDir, "a1"), "versions", "v1", "web.glb"))),
    );
  });

  test("Web: web.glb versi apa adanya; setelah meshopt dibuka, 0 error validator", async () => {
    addAsset("a1", "Peti Kayu");
    await addBaseVersion("a1");
    await addTexturedVersion("a1");
    for (const version of [1, 2]) {
      const served = await service.file("a1", version, "web");
      const bytes = new Uint8Array(await readFile(served.path));
      expect(served.downloadName).toBe(`peti-kayu-v${version}-web.glb`);
      expect(await extensionsOf(bytes)).toContain("EXT_meshopt_compression");
      // gltf-validator tidak bisa membaca EXT_meshopt_compression: buffer dibuka dulu (dekoder meshopt), lalu ditulis
      // ulang tanpa kompresi dan divalidasi.
      const document = await readGlb(bytes);
      for (const extension of document.getRoot().listExtensionsUsed()) {
        if (extension.extensionName === "EXT_meshopt_compression") extension.dispose();
      }
      const report = await validateGlb(await writeGlb(document));
      expect([version, report.errors]).toEqual([version, 0]);
    }
  });

  test("Unity: dibuat sekali ke derived/, tanpa ekstensi kompresi, tekstur PNG; permintaan bersamaan berbagi hasil", async () => {
    addAsset("a1", "Peti Kayu");
    await addBaseVersion("a1");
    await addTexturedVersion("a1");
    const [first, second] = await Promise.all([
      service.file("a1", 2, "unity"),
      service.file("a1", 2, "unity"),
    ]);
    expect(first.path).toBe(second.path);
    expect(first.downloadName).toBe("peti-kayu-v2-unity.glb");
    expect(first.path.endsWith(join("derived", "v2", UNITY_EXPORT_FILE))).toBe(true);
    const glb = new Uint8Array(await readFile(first.path));
    expect((await extensionsOf(glb)).filter((name) => UNITY_BLOCKED_EXTENSIONS.has(name))).toEqual([]);
    const mimes = (await readGlb(glb))
      .getRoot()
      .listTextures()
      .map((texture) => texture.getMimeType());
    expect(new Set(mimes)).toEqual(new Set(["image/png"]));
    // Hanya file cache dan contact sheet/thumbnail lain; tidak ada file sementara yang tertinggal.
    expect((await readdir(join(assetDirFor(dataDir, "a1"), "derived", "v2"))).sort()).toEqual([
      UNITY_EXPORT_FILE,
    ]);
    const before = (await stat(first.path)).mtimeMs;
    await service.file("a1", 2, "unity");
    expect((await stat(first.path)).mtimeMs).toBe(before);
  });

  test("Sumber bentuk dasar: folder akar, README, .blend, skrip, statistik; tanpa tekstur", async () => {
    addAsset("a1", "Peti Kayu");
    await addBaseVersion("a1");
    const served = await service.file("a1", 1, "source");
    expect([served.contentType, served.downloadName]).toEqual(["application/zip", "peti-kayu-v1-sumber.zip"]);
    const files = unzipSync(new Uint8Array(await readFile(served.path)));
    expect(Object.keys(files)).toEqual([
      "peti-kayu-v1-sumber/README.md",
      "peti-kayu-v1-sumber/scene.blend",
      "peti-kayu-v1-sumber/script.py",
      "peti-kayu-v1-sumber/stats.json",
    ]);
    expect(files["peti-kayu-v1-sumber/scene.blend"]).toEqual(new Uint8Array(4096).fill(7));
    const readme = strFromU8(files["peti-kayu-v1-sumber/README.md"] ?? new Uint8Array());
    expect(readme).toContain("# Peti Kayu — sumber v1");
    expect(readme).toContain("probe peti-kayu-v1-sumber/script.py --base");
    expect(readme).toContain("> peti kayu\n> baris kedua");
    expect(readme).toContain("jangan izinkan Blender menjalankan skrip Python");
    expect(readme).not.toContain("tidak tersedia");
  });

  test("Sumber aset final: base.py, budget aset, dan tekstur PNG; README mencatat .blend yang tidak ada", async () => {
    addAsset("a1", "Peti Kayu", CUSTOM_SEDANG);
    await addBaseVersion("a1");
    await addTexturedVersion("a1");
    const files = unzipSync(new Uint8Array(await readFile((await service.file("a1", 2, "source")).path)));
    const names = Object.keys(files);
    expect(names).toEqual([
      "peti-kayu-v2-sumber/README.md",
      "peti-kayu-v2-sumber/script.py",
      "peti-kayu-v2-sumber/base.py",
      "peti-kayu-v2-sumber/stats.json",
      "peti-kayu-v2-sumber/budget.json",
      "peti-kayu-v2-sumber/textures/basecolor.png",
      "peti-kayu-v2-sumber/textures/normal.png",
      "peti-kayu-v2-sumber/textures/orm.png",
    ]);
    for (const name of names.filter((entry) => entry.endsWith(".png"))) {
      expect((await sharp(files[name] ?? new Uint8Array()).metadata()).format).toBe("png");
    }
    const readme = strFromU8(files["peti-kayu-v2-sumber/README.md"] ?? new Uint8Array());
    // Skrip dijalankan ulang dengan budget aset ini (snapshot saat aset dibuat), bukan budget bawaan.
    expect(JSON.parse(strFromU8(files["peti-kayu-v2-sumber/budget.json"] ?? new Uint8Array()))).toEqual({
      tierId: "sedang",
      budget: CUSTOM_SEDANG,
    });
    expect(readme).toContain(
      "--textured sedang --budget peti-kayu-v2-sumber/budget.json --base-script peti-kayu-v2-sumber/base.py",
    );
    expect(readme).toContain("| `budget.json` |");
    expect(readme).toContain("`.blend` tidak tersedia");
    expect(readme).not.toContain("jangan izinkan");
  });

  test("Sumber setelah ganti nama: dibuat ulang dengan nama baru; nama lama tetap memakai cache-nya", async () => {
    addAsset("a1", "Tong kayu");
    await addBaseVersion("a1");
    const rootOf = async (path: string) => Object.keys(unzipSync(new Uint8Array(await readFile(path))))[0];
    const before = await service.file("a1", 1, "source");
    expect(await rootOf(before.path)).toBe("tong-kayu-v1-sumber/README.md");
    renameAsset(handle.db, "a1", "Tong anggur", 3);
    const after = await service.file("a1", 1, "source");
    expect(after.downloadName).toBe("tong-anggur-v1-sumber.zip");
    expect(await rootOf(after.path)).toBe("tong-anggur-v1-sumber/README.md");
    const readme = strFromU8(
      unzipSync(new Uint8Array(await readFile(after.path)))["tong-anggur-v1-sumber/README.md"] ??
        new Uint8Array(),
    );
    expect(readme).toContain("# Tong anggur — sumber v1");
    expect(
      (await service.estimate("a1", 1)).presets.find((preset) => preset.preset === "source"),
    ).toMatchObject({
      bytes: after.size,
      exact: true,
    });
    renameAsset(handle.db, "a1", "Tong kayu", 4);
    expect((await service.file("a1", 1, "source")).path).toBe(before.path);
  });

  test("nama aset berbahaya tidak keluar dari folder (zip-slip)", async () => {
    addAsset("a1", "../../../etc/passwd");
    await addBaseVersion("a1");
    const served = await service.file("a1", 1, "source");
    expect(served.downloadName).toBe("etc-passwd-v1-sumber.zip");
    for (const name of Object.keys(unzipSync(new Uint8Array(await readFile(served.path))))) {
      expect(() => assertZipPath(name)).not.toThrow();
      expect(name.startsWith("etc-passwd-v1-sumber/")).toBe(true);
    }
  });

  test("perkiraan ukuran: Web pasti; Unity/Sumber perkiraan sampai file dibuat, lalu ukuran sebenarnya", async () => {
    addAsset("a1", "Peti Kayu");
    await addBaseVersion("a1");
    await addTexturedVersion("a1");
    const before = await service.estimate("a1", 2);
    expect(before.presets.map((preset) => [preset.preset, preset.fileName, preset.exact])).toEqual([
      ["web", "peti-kayu-v2-web.glb", true],
      ["unity", "peti-kayu-v2-unity.glb", false],
      ["source", "peti-kayu-v2-sumber.zip", false],
    ]);
    for (const preset of before.presets) expect(preset.bytes).toBeGreaterThan(0);
    const web = await service.file("a1", 2, "web");
    const unity = await service.file("a1", 2, "unity");
    const source = await service.file("a1", 2, "source");
    const after = await service.estimate("a1", 2);
    expect(after.presets.map((preset) => [preset.preset, preset.bytes, preset.exact])).toEqual([
      ["web", web.size, true],
      ["unity", unity.size, true],
      ["source", source.size, true],
    ]);
  });

  test("aset, versi, atau GLB rusak → error bertipe; cache tidak tertinggal", async () => {
    addAsset("a1", "Peti");
    await expect(service.file("x", 1, "web")).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
    await expect(service.file("a1", 1, "web")).rejects.toMatchObject({ code: "VERSION_NOT_FOUND" });
    await expect(service.estimate("a1", 1)).rejects.toMatchObject({ code: "VERSION_NOT_FOUND" });

    const processed = await processGlb(await writeGlb(gridDocument(2)), { tierId: "sedang", stage: "base" });
    await addVersion("a1", 1, "base", processed, [
      { name: "base.glb", data: new Uint8Array([1, 2, 3]) },
      { name: "web.glb", data: processed.web ?? new Uint8Array() },
      { name: "script.py", data: "x\n" },
    ]);
    // Pesan ke klien tetap (tanpa pesan library atau path); detailnya dicatat lewat `onError`.
    const failed = { code: "EXPORT_FAILED", message: "Ekspor gagal dibuat. Detailnya ada di log server." };
    await expect(service.file("a1", 1, "unity")).rejects.toMatchObject(failed);
    await expect(service.file("a1", 1, "source")).rejects.toMatchObject(failed);
    expect(errors).toHaveLength(2);
    expect(await readdir(join(assetDirFor(dataDir, "a1"), "derived", "v1")).catch(() => [])).toEqual([]);
    expect(await stat(derived("a1", 1, sourceExportFile("Peti"))).catch(() => null)).toBeNull();
  });

  test("GLB yang tidak bisa dijadikan Unity: pesan validator diteruskan (sudah berbahasa Indonesia)", async () => {
    addAsset("a1", "Peti");
    const ktx = gridDocument(2, (doc) =>
      doc.createMaterial("ktx").setBaseColorTexture(
        doc
          .createTexture("ktx")
          .setImage(new Uint8Array([1, 2, 3]))
          .setMimeType("image/ktx2"),
      ),
    );
    const processed = await processGlb(await writeGlb(gridDocument(2)), { tierId: "sedang", stage: "base" });
    await addVersion("a1", 1, "base", processed, [
      { name: "base.glb", data: await writeGlb(ktx) },
      { name: "web.glb", data: processed.web ?? new Uint8Array() },
      { name: "script.py", data: "x\n" },
    ]);
    await expect(service.file("a1", 1, "unity")).rejects.toMatchObject({
      code: "EXPORT_FAILED",
      message: "Ekspor gagal dibuat. Tekstur KTX2 tidak bisa diubah ke PNG.",
    });
    expect(errors).toHaveLength(1);
  });
});

describe("ExportService — hapus aset", () => {
  test("settleAsset menunggu pembuatan file ekspor aset itu yang sedang berjalan", async () => {
    addAsset("a1", "Peti");
    await addBaseVersion("a1");
    await addTexturedVersion("a1");
    const request = service.file("a1", 2, "unity");
    await service.settleAsset("a1");
    expect((await stat(derived("a1", 2, UNITY_EXPORT_FILE))).isFile()).toBe(true);
    expect((await request).path).toEndWith(UNITY_EXPORT_FILE);
    // Pembuatan yang gagal tidak membuat settleAsset gagal.
    addAsset("a2", "Rusak");
    const processed = await processGlb(await writeGlb(gridDocument(2)), { tierId: "sedang", stage: "base" });
    await addVersion("a2", 1, "base", processed, [
      { name: "base.glb", data: new Uint8Array([1, 2, 3]) },
      { name: "web.glb", data: processed.web ?? new Uint8Array() },
      { name: "script.py", data: "x\n" },
    ]);
    const failing = service.file("a2", 1, "unity").catch((error: unknown) => error);
    await service.settleAsset("a2");
    expect(await failing).toMatchObject({ code: "EXPORT_FAILED" });
  });
});

describe("ExportService — ZIP Gudang", () => {
  test("Web: versi terkini tiap aset, nama unik walau nama aset sama", async () => {
    addAsset("a1", "Peti");
    addAsset("a2", "Peti");
    addAsset("a3", "Kursi Taman");
    for (const id of ["a1", "a2", "a3"]) await addBaseVersion(id);
    await addTexturedVersion("a3");
    setCurrent("a1", 1);
    setCurrent("a2", 1);
    setCurrent("a3", 2);
    const zip = await service.zip(["a1", "a2", "a3"], "web");
    expect(zip.downloadName).toBe("gudang-3-aset-web.zip");
    const files = unzipSync(new Uint8Array(await new Response(zip.stream).arrayBuffer()));
    expect(Object.keys(files)).toEqual(["peti-v1-web.glb", "peti-2-v1-web.glb", "kursi-taman-v2-web.glb"]);
    expect(files["kursi-taman-v2-web.glb"]).toEqual(
      new Uint8Array(await readFile(join(assetDirFor(dataDir, "a3"), "versions", "v2", "web.glb"))),
    );
    expect(errors).toEqual([]);
  });

  test("Unity: GLB tanpa ekstensi kompresi, dibuat sebelum stream dimulai dan di-cache", async () => {
    addAsset("a1", "Peti");
    await addBaseVersion("a1");
    await addTexturedVersion("a1");
    setCurrent("a1", 2);
    const files = unzipSync(
      new Uint8Array(await new Response((await service.zip(["a1"], "unity")).stream).arrayBuffer()),
    );
    const glb = files["peti-v2-unity.glb"] ?? new Uint8Array();
    expect((await extensionsOf(glb)).filter((name) => UNITY_BLOCKED_EXTENSIONS.has(name))).toEqual([]);
    expect(new Uint8Array(await readFile(derived("a1", 2, UNITY_EXPORT_FILE)))).toEqual(glb);
  });

  test("aset tanpa versi atau tidak dikenal ditolak sebelum stream dimulai", async () => {
    addAsset("a1", "Peti");
    addAsset("a2", "Kosong");
    await addBaseVersion("a1");
    setCurrent("a1", 1);
    for (const run of [
      (ids: string[]) => service.zip(ids, "web"),
      (ids: string[]) => service.prepareZip(ids, "web"),
    ]) {
      await expect(run(["a1", "a2"])).rejects.toMatchObject({ code: "NO_VERSION" });
      await expect(run(["a1", "x"])).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
    }
  });

  test("pemeriksaan ZIP: GLB Unity dibuat dan divalidasi lebih dulu; jumlah aset dan total ukuran", async () => {
    addAsset("a1", "Peti");
    addAsset("a2", "Kursi");
    await addBaseVersion("a1");
    await addBaseVersion("a2");
    setCurrent("a1", 1);
    setCurrent("a2", 1);
    const summary = await service.prepareZip(["a1", "a2"], "unity");
    const sizes = await Promise.all(
      ["a1", "a2"].map(async (id) => (await stat(derived(id, 1, UNITY_EXPORT_FILE))).size),
    );
    expect(summary).toEqual({ assets: 2, bytes: sizes.reduce((sum, size) => sum + size, 0) });
    expect(errors).toEqual([]);
  });

  test("GLB rusak untuk ZIP Unity: ditolak sebelum stream dimulai, error dicatat sekali", async () => {
    addAsset("a1", "Peti");
    const processed = await processGlb(await writeGlb(gridDocument(2)), { tierId: "sedang", stage: "base" });
    await addVersion("a1", 1, "base", processed, [
      { name: "base.glb", data: new Uint8Array([1, 2, 3]) },
      { name: "web.glb", data: processed.web ?? new Uint8Array() },
      { name: "script.py", data: "x\n" },
    ]);
    setCurrent("a1", 1);
    await expect(service.zip(["a1"], "unity")).rejects.toMatchObject({ code: "EXPORT_FAILED" });
    expect(errors).toHaveLength(1);
  });
});
