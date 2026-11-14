import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectOutputs } from "./outputs.ts";

let dir: string;
const allowed = { "base.glb": 100, "stats.json": 10 };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "aag-outputs-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("collectOutputs", () => {
  test("file biasa yang diizinkan diterima", async () => {
    await writeFile(join(dir, "base.glb"), "glTF");
    const scan = await collectOutputs(dir, allowed);
    expect(scan).toEqual({
      accepted: [{ name: "base.glb", path: join(dir, "base.glb"), bytes: 4 }],
      rejected: [],
    });
  });

  test("symlink ke /etc/passwd tidak diikuti", async () => {
    await symlink("/etc/passwd", join(dir, "base.glb"));
    const scan = await collectOutputs(dir, allowed);
    expect(scan.accepted).toEqual([]);
    expect(scan.rejected).toEqual([{ name: "base.glb", reason: "symlink" }]);
  });

  test("folder, nama asing, file terlalu besar, dan hardlink ditolak", async () => {
    await mkdir(join(dir, "stats.json"));
    await writeFile(join(dir, "run.sh"), "x");
    await writeFile(join(dir, "base.glb"), "x".repeat(101));
    const scan = await collectOutputs(dir, allowed);
    expect(scan.rejected).toEqual([
      { name: "base.glb", reason: "too_large" },
      { name: "run.sh", reason: "not_allowed" },
      { name: "stats.json", reason: "not_file" },
    ]);

    const other = join(dir, "..", `${dir.split("/").at(-1)}-src`);
    await writeFile(other, "{}");
    await rm(join(dir, "stats.json"), { recursive: true });
    await link(other, join(dir, "stats.json"));
    const hard = await collectOutputs(dir, allowed);
    expect(hard.rejected).toContainEqual({ name: "stats.json", reason: "hardlink" });
    await rm(other);
  });

  test("nama milik prototype objek tidak dianggap diizinkan", async () => {
    await writeFile(join(dir, "constructor"), "x");
    expect((await collectOutputs(dir, allowed)).rejected).toEqual([
      { name: "constructor", reason: "not_allowed" },
    ]);
  });

  test("folder yang tidak ada → kosong", async () => {
    expect(await collectOutputs(join(dir, "tidak-ada"), allowed)).toEqual({ accepted: [], rejected: [] });
  });
});
