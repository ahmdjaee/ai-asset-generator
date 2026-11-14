/**
 * Batas arsitektur (AGENTS.md §3, §7): arah dependensi antarlapisan dan "satu pintu per integrasi". Import dibaca
 * dari teks sumber (statik, `export … from`, dan `import()` dinamis); path relatif di-resolve ke path repo.
 * Pintu Agent SDK (`query` hanya di sdk-adapter) dijaga `server/agent/boundaries.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const SOURCE_DIRS = ["server", "shared", "web", "scripts"] as const;

type ImportRef = Readonly<{ file: string; spec: string; target: string; typeOnly: boolean; names: string }>;

const isTest = (file: string) => /\.test\.tsx?$/.test(file);

async function sourceFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const dir of SOURCE_DIRS) {
    for await (const file of new Bun.Glob(`${dir}/**/*.{ts,tsx}`).scan({ cwd: ROOT })) {
      if (!file.includes("node_modules/")) files.push(file);
    }
  }
  return files.sort();
}

const STATIC_IMPORT = /^\s*(import|export)\s+(type\s+)?([^'"]*?)\s*from\s*["']([^"']+)["']/gm;
const SIDE_EFFECT_IMPORT = /^\s*import\s+["']([^"']+)["']/gm;
const DYNAMIC_IMPORT = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

function resolveTarget(file: string, spec: string): string {
  if (!spec.startsWith(".")) return spec;
  return relative(ROOT, resolve(ROOT, dirname(file), spec));
}

async function importsOf(file: string): Promise<ImportRef[]> {
  const text = await readFile(join(ROOT, file), "utf8");
  const refs: ImportRef[] = [];
  for (const match of text.matchAll(STATIC_IMPORT)) {
    const names = match[3] ?? "";
    const spec = match[4] ?? "";
    // `import { type A, type B }` juga hanya tipe.
    const inline = /^\{([^}]*)\}$/.exec(names.trim())?.[1];
    const allInlineTypes =
      inline
        ?.split(",")
        .map((part) => part.trim())
        .filter((part) => part !== "")
        .every((part) => part.startsWith("type ")) === true;
    refs.push({
      file,
      spec,
      target: resolveTarget(file, spec),
      typeOnly: match[2] !== undefined || allInlineTypes,
      names,
    });
  }
  for (const match of text.matchAll(SIDE_EFFECT_IMPORT)) {
    const spec = match[1] ?? "";
    refs.push({ file, spec, target: resolveTarget(file, spec), typeOnly: false, names: "" });
  }
  for (const match of text.matchAll(DYNAMIC_IMPORT)) {
    const spec = match[1] ?? "";
    refs.push({ file, spec, target: resolveTarget(file, spec), typeOnly: false, names: "" });
  }
  return refs;
}

const files = await sourceFiles();
const allImports = (await Promise.all(files.map(importsOf))).flat();

function violations(filter: (ref: ImportRef) => boolean): string[] {
  return allImports.filter(filter).map((ref) => `${ref.file} → ${ref.spec}`);
}

const under = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`);

describe("batas arsitektur", () => {
  test("pemindai menemukan file dan import (pengaman tes ini sendiri)", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(
      allImports.some((ref) => ref.file === "server/services/assets.ts" && ref.spec === "./bus.ts"),
    ).toBe(true);
  });

  test("server/domain murni: hanya shared, domain, dan zod (tanpa I/O)", () => {
    expect(
      violations(
        (ref) =>
          under(ref.file, "server/domain") &&
          !isTest(ref.file) &&
          !under(ref.target, "shared") &&
          !under(ref.target, "server/domain") &&
          ref.target !== "zod",
      ),
    ).toEqual([]);
  });

  test("shared hanya bergantung pada shared dan zod", () => {
    expect(
      violations(
        (ref) =>
          under(ref.file, "shared") &&
          !under(ref.target, "shared") &&
          ref.target !== "zod" &&
          !(isTest(ref.file) && ref.target === "bun:test"),
      ),
    ).toEqual([]);
  });

  test("services tidak bergantung pada lapisan agent, http, realtime, atau akar komposisi", () => {
    // Runtime dan renderer boleh dipakai (lewat pintunya masing-masing); yang dilarang lapisan di atas services.
    const forbidden = ["server/agent", "server/http", "server/realtime"];
    expect(
      violations(
        (ref) =>
          under(ref.file, "server/services") &&
          !isTest(ref.file) &&
          (forbidden.some((dir) => under(ref.target, dir)) ||
            ["server/main.ts", "server/app.ts", "server/compose.ts"].includes(ref.target)),
      ),
    ).toEqual([]);
  });

  test("database hanya lewat server/db (drizzle, skema, dan bun:sqlite tidak dipakai di luar)", () => {
    expect(
      violations(
        (ref) =>
          !under(ref.file, "server/db") &&
          (ref.target.startsWith("drizzle-orm") ||
            ref.target === "bun:sqlite" ||
            ref.target === "server/db/schema.ts" ||
            ref.target === "server/db/migrate.ts"),
      ),
    ).toEqual([]);
  });

  test("lapisan http, realtime, dan agent tidak mengakses repositori langsung (lewat services)", () => {
    expect(
      violations(
        (ref) =>
          ["server/http", "server/realtime", "server/agent"].some((dir) => under(ref.file, dir)) &&
          !isTest(ref.file) &&
          under(ref.target, "server/db"),
      ),
    ).toEqual([]);
  });

  test("web hanya bergantung pada shared dan tipe AppType dari server", () => {
    expect(
      violations(
        (ref) =>
          under(ref.file, "web") &&
          (under(ref.target, "server") || under(ref.target, "scripts")) &&
          !(ref.target === "server/app.ts" && ref.typeOnly),
      ),
    ).toEqual([]);
  });

  test("Playwright hanya di server/render (renderer)", () => {
    expect(
      violations(
        (ref) =>
          under(ref.file, "server") &&
          !under(ref.file, "server/render") &&
          (ref.target.startsWith("playwright") || ref.target.startsWith("@playwright/")),
      ),
    ).toEqual([]);
  });

  test("CLI docker hanya dipanggil dari server/runtime/docker.ts", async () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file === "server/runtime/docker.ts" || isTest(file)) continue;
      const text = await readFile(join(ROOT, file), "utf8");
      if (/spawn(Sync)?\(\s*\[\s*["']docker["']/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
