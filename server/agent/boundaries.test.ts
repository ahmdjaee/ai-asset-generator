/** Pintu tunggal Agent SDK (AGENTS.md §3 dan §6): hanya sdk-adapter.ts yang memanggil `query`. */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { Glob } from "bun";

const ROOT = join(import.meta.dir, "../..");
const SOURCE_DIRS = ["server", "shared", "web", "scripts", "tests"];
/** Satu-satunya file teks UI (AGENTS.md §2). */
const UI_TEXT = "web/i18n/id.ts";

async function sources(): Promise<string[]> {
  const files: string[] = [];
  for (const dir of SOURCE_DIRS) {
    for await (const file of new Glob("**/*.{ts,tsx}").scan({ cwd: join(ROOT, dir) }))
      files.push(join(ROOT, dir, file));
  }
  return files;
}

describe("batas Agent SDK", () => {
  test("hanya server/agent/sdk-adapter.ts yang meng-import `query`", async () => {
    const offenders: string[] = [];
    for (const file of await sources()) {
      const content = await readFile(file, "utf8");
      const imports = content.matchAll(
        /import\s*\{([^}]*)\}\s*from\s*["']@anthropic-ai\/claude-agent-sdk["']/g,
      );
      for (const match of imports) {
        const names = (match[1] ?? "").split(",").map((name) => name.trim().replace(/^type\s+/, ""));
        if (names.includes("query") && !match[1]?.includes("type query"))
          offenders.push(relative(ROOT, file));
      }
    }
    // Tes smoke Tahap 0 hanya memastikan export `query` ada (typeof), tidak pernah memanggilnya.
    expect(offenders).toEqual(["server/agent/sdk-adapter.ts", "tests/smoke/imports.test.ts"]);
  });

  test("kode web tidak meng-import Agent SDK sama sekali", async () => {
    const offenders: string[] = [];
    for (const file of await sources()) {
      if (!relative(ROOT, file).startsWith("web/")) continue;
      if ((await readFile(file, "utf8")).includes("@anthropic-ai/claude-agent-sdk"))
        offenders.push(relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  test("tidak ada kode yang membaca ANTHROPIC_API_KEY selain penghapusnya di agentEnv()", async () => {
    const offenders: string[] = [];
    for (const file of await sources()) {
      const path = relative(ROOT, file);
      if (path.endsWith(".test.ts")) continue;
      const content = await readFile(file, "utf8");
      if (!/ANTHROPIC_(API_KEY|AUTH_TOKEN)/.test(content) || path === "server/config.ts") continue;
      // Teks UI boleh menyebut nama variabelnya (petunjuk "hapus ANTHROPIC_API_KEY" di banner dan Pengaturan), asal
      // file teks itu sendiri tidak menyentuh env sama sekali.
      if (path === UI_TEXT && !/\b(process|Bun)\.env\b|import\.meta\.env/.test(content)) continue;
      offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });
});
