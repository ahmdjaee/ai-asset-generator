import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtimeImageTag } from "./image.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "aag-image-"));
  await writeFile(join(dir, "Dockerfile"), "FROM scratch\n");
  await writeFile(join(dir, "requirements.txt"), "bpy==5.2.4\n");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("tag deterministik dari isi Dockerfile + requirements", async () => {
  const tag = await runtimeImageTag(dir);
  expect(tag).toMatch(/^asset-forge:[0-9a-f]{12}$/);
  expect(await runtimeImageTag(dir)).toBe(tag);
});

test("tag berubah bila requirements berubah", async () => {
  const before = await runtimeImageTag(dir);
  await writeFile(join(dir, "requirements.txt"), "bpy==5.2.5\n");
  expect(await runtimeImageTag(dir)).not.toBe(before);
});

test("file lain di runtime/ tidak memengaruhi tag", async () => {
  const before = await runtimeImageTag(dir);
  await writeFile(join(dir, "catatan.md"), "x");
  expect(await runtimeImageTag(dir)).toBe(before);
});
