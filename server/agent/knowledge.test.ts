/** `runtime/knowledge` harus sama dengan kode `assetkit` dan skrip contoh (AGENTS.md §7). */
import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ASSETKIT_DIR, KNOWLEDGE_DIR, RUNTIME_DIR } from "../runtime/image.ts";

const MODULES = ["scene", "prim", "mod", "protocol", "material", "decal", "bake", "uv"] as const;

async function publicFunctions(module: string): Promise<string[]> {
  const source = await readFile(join(ASSETKIT_DIR, "assetkit", `${module}.py`), "utf8");
  return [...source.matchAll(/^def ([a-z][a-z0-9_]*)\(/gm)].map((match) => match[1] ?? "");
}

describe("runtime/knowledge", () => {
  test("API.md menyebut setiap fungsi publik assetkit", async () => {
    const api = await readFile(join(KNOWLEDGE_DIR, "API.md"), "utf8");
    const missing: string[] = [];
    for (const module of MODULES) {
      for (const name of await publicFunctions(module)) {
        if (!api.includes(`${module}.${name}(`)) missing.push(`${module}.${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("setiap resep cookbook memuat skrip contoh yang diuji, sama persis", async () => {
    const files = (await readdir(join(KNOWLEDGE_DIR, "cookbook")))
      .filter((file) => file.endsWith(".md"))
      .sort();
    expect(files).toEqual([
      "barrel.md",
      "chair.md",
      "crate.md",
      "simple-creature.md",
      "stylized-tree.md",
      "textured-crate.md",
      "textured-creature.md",
    ]);
    for (const file of files) {
      const recipe = await readFile(join(KNOWLEDGE_DIR, "cookbook", file), "utf8");
      const source = recipe.match(/Sumber: `runtime\/samples\/((?:textured\/)?[a-z]+)\.py`/)?.[1];
      const code = recipe.match(/```python\n([\s\S]*?)\n```/)?.[1];
      expect(source, file).toBeDefined();
      const sample = await readFile(join(RUNTIME_DIR, "samples", `${source}.py`), "utf8");
      expect(code, file).toBe(sample.trimEnd());
    }
  });

  test("setiap skrip contoh (bentuk dasar dan bertekstur) punya resep", async () => {
    const samples = [
      ...(await readdir(join(RUNTIME_DIR, "samples"))).filter((file) => file.endsWith(".py")),
      ...(await readdir(join(RUNTIME_DIR, "samples", "textured")))
        .filter((file) => file.endsWith(".py"))
        .map((file) => `textured/${file}`),
    ];
    const recipes = await Promise.all(
      (await readdir(join(KNOWLEDGE_DIR, "cookbook"))).map((file) =>
        readFile(join(KNOWLEDGE_DIR, "cookbook", file), "utf8"),
      ),
    );
    for (const sample of samples) {
      expect(
        recipes.some((recipe) => recipe.includes(`runtime/samples/${sample}`)),
        sample,
      ).toBe(true);
    }
  });
});
