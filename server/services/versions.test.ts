import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createVersion,
  listVersions,
  readManifest,
  VersionError,
  verifyVersion,
  versionDir,
  writeDerived,
} from "./versions.ts";

let assetDir: string;
const fixedNow = () => new Date("2026-11-13T08:00:00.000Z");
const files = [
  { name: "base.glb", data: new Uint8Array([103, 108, 84, 70]) },
  { name: "script.py", data: "print('halo')\n" },
];

beforeEach(async () => {
  assetDir = await mkdtemp(join(tmpdir(), "aag-versions-"));
});

afterEach(async () => {
  // Folder versi read-only; izinkan tulis lagi supaya bisa dihapus.
  for (const version of await listVersions(assetDir)) await chmod(versionDir(assetDir, version), 0o755);
  await rm(assetDir, { recursive: true, force: true });
});

describe("createVersion", () => {
  test("v1 berisi file, manifest sha256, dan semuanya read-only", async () => {
    const manifest = await createVersion({ assetDir, files, meta: { tier: "sedang" }, now: fixedNow });
    expect(manifest).toEqual({
      version: 1,
      createdAt: "2026-11-13T08:00:00.000Z",
      files: [
        { name: "base.glb", bytes: 4, sha256: createHash("sha256").update("glTF").digest("hex") },
        expect.objectContaining({ name: "script.py", bytes: 14 }),
      ],
      meta: { tier: "sedang" },
    });
    const dir = versionDir(assetDir, 1);
    expect((await readdir(dir)).sort()).toEqual(["base.glb", "manifest.json", "script.py"]);
    expect((await stat(dir)).mode & 0o777).toBe(0o555);
    for (const name of ["base.glb", "manifest.json", "script.py"]) {
      expect((await stat(join(dir, name))).mode & 0o777).toBe(0o444);
    }
    expect(await readManifest(assetDir, 1)).toEqual(manifest);
    expect(await verifyVersion(assetDir, 1)).toEqual({ ok: true, mismatched: [] });
  });

  test("isi versi tidak bisa ditimpa atau ditambah file", async () => {
    await createVersion({ assetDir, files, now: fixedNow });
    const dir = versionDir(assetDir, 1);
    await expect(writeFile(join(dir, "base.glb"), "x")).rejects.toThrow();
    await expect(writeFile(join(dir, "baru.txt"), "x")).rejects.toThrow();
  });

  test("nomor versi berurutan dan tidak ada folder staging tersisa", async () => {
    await createVersion({ assetDir, files, now: fixedNow });
    const second = await createVersion({ assetDir, files, now: fixedNow });
    expect(second.version).toBe(2);
    expect(await listVersions(assetDir)).toEqual([1, 2]);
    expect((await readdir(join(assetDir, "versions"))).sort()).toEqual(["v1", "v2"]);
  });

  test("dua versi dibuat bersamaan mendapat nomor berbeda", async () => {
    const results = await Promise.all([
      createVersion({ assetDir, files, now: fixedNow }),
      createVersion({ assetDir, files, now: fixedNow }),
      createVersion({ assetDir, files, now: fixedNow }),
    ]);
    expect(results.map((manifest) => manifest.version).sort()).toEqual([1, 2, 3]);
    for (const version of [1, 2, 3]) expect((await verifyVersion(assetDir, version)).ok).toBe(true);
  });

  test.each(["../luar.glb", "Base.glb", "manifest.json", ".tersembunyi", "a/b.glb", ""])(
    "nama file tidak valid ditolak: %p",
    async (name) => {
      await expect(createVersion({ assetDir, files: [{ name, data: "x" }] })).rejects.toBeInstanceOf(
        VersionError,
      );
      expect(await listVersions(assetDir)).toEqual([]);
    },
  );

  test("file ganda atau versi kosong ditolak", async () => {
    await expect(createVersion({ assetDir, files: [] })).rejects.toMatchObject({ code: "NO_FILES" });
    await expect(
      createVersion({
        assetDir,
        files: [
          { name: "a.txt", data: "1" },
          { name: "a.txt", data: "2" },
        ],
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_FILE" });
  });
});

describe("verifyVersion", () => {
  test("mendeteksi file yang diubah di luar app", async () => {
    await createVersion({ assetDir, files, now: fixedNow });
    const dir = versionDir(assetDir, 1);
    await chmod(dir, 0o755);
    await chmod(join(dir, "script.py"), 0o644);
    await writeFile(join(dir, "script.py"), "print('diubah')\n");
    expect(await verifyVersion(assetDir, 1)).toEqual({ ok: false, mismatched: ["script.py"] });
  });

  test("versi yang tidak ada", async () => {
    await expect(readManifest(assetDir, 7)).rejects.toMatchObject({ code: "VERSION_NOT_FOUND" });
  });
});

describe("writeDerived", () => {
  test("menulis ke derived/vN tanpa menyentuh versi, dan boleh menimpa hasil turunan lama", async () => {
    await createVersion({ assetDir, files, now: fixedNow });
    const path = await writeDerived(assetDir, 1, "contact-sheet.png", "png-1");
    expect(path).toBe(join(assetDir, "derived", "v1", "contact-sheet.png"));
    await writeDerived(assetDir, 1, "contact-sheet.png", "png-2");
    expect(await readFile(path, "utf8")).toBe("png-2");
    expect(await readdir(join(assetDir, "derived", "v1"))).toEqual(["contact-sheet.png"]);
    expect((await verifyVersion(assetDir, 1)).ok).toBe(true);
  });

  test("versi yang belum ada atau nama tidak valid ditolak", async () => {
    await expect(writeDerived(assetDir, 1, "x.png", "x")).rejects.toMatchObject({
      code: "VERSION_NOT_FOUND",
    });
    await createVersion({ assetDir, files, now: fixedNow });
    await expect(writeDerived(assetDir, 1, "../x.png", "x")).rejects.toMatchObject({
      code: "INVALID_FILE_NAME",
    });
  });
});
