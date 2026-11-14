import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJobDir, removeJobDir, texturedJobCommand } from "./job-dir.ts";

let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "aag-jobs-")));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("membuat folder job dengan out/ dan salinan skrip", async () => {
  const script = join(root, "contoh.py");
  await writeFile(script, "print(1)\n");
  const dir = await createJobDir(join(root, "jobs"), script);
  expect(dir.path.startsWith(join(root, "jobs", "job-"))).toBe(true);
  expect((await stat(dir.outputDir)).isDirectory()).toBe(true);
  expect(await readFile(join(dir.path, "script.py"), "utf8")).toBe("print(1)\n");
  await removeJobDir(join(root, "jobs"), dir);
  await expect(stat(dir.path)).rejects.toThrow();
});

test("menolak menghapus folder di luar root", async () => {
  await createJobDir(join(root, "jobs"));
  await expect(
    removeJobDir(join(root, "jobs"), { path: root, outputDir: join(root, "out") }),
  ).rejects.toThrow(/Menolak/);
  expect((await stat(root)).isDirectory()).toBe(true);
});

test("file tambahan (base.py) ikut disalin; nama aneh ditolak", async () => {
  const script = join(root, "material.py");
  const base = join(root, "dasar.py");
  await writeFile(script, "print('m')\n");
  await writeFile(base, "print('b')\n");
  const dir = await createJobDir(join(root, "jobs"), script, { "base.py": base });
  expect(await readFile(join(dir.path, "base.py"), "utf8")).toBe("print('b')\n");
  for (const name of ["../x.py", "script.py", "out/x.py", "x.sh"]) {
    await expect(createJobDir(join(root, "jobs"), script, { [name]: base })).rejects.toThrow(/tidak valid/);
  }
});

test("perintah job bertekstur memuat ukuran bake tier dan resolusi pustaka", () => {
  expect(texturedJobCommand({ baseColor: 512, library: "1k" })).toEqual([
    "python",
    "-m",
    "assetkit.run",
    "/job/script.py",
    "--textured",
    "--base-color",
    "512",
    "--library-res",
    "1k",
    "--export",
    "/job/out/final.glb",
    "--stats",
    "/job/out/stats.json",
    "--blend",
    "/job/out/scene.blend",
  ]);
  expect(texturedJobCommand({ baseColor: 2048, normal: 2048, orm: 1024, library: "2k" }).join(" ")).toContain(
    "--base-color 2048 --normal 2048 --orm 1024 --library-res 2k",
  );
});
