/**
 * Dokumentasi (`docs/`, `README.md`, `AGENTS.md`): tautan relatif dan gambar harus menunjuk file yang ada, anchor ke
 * judul yang ada, dan setiap halaman `docs/fitur` + `docs/teknis` terdaftar di indeks `docs/README.md`.
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const SECTIONS = ["docs/fitur", "docs/teknis"] as const;

async function markdownFiles(): Promise<string[]> {
  const files = ["README.md", "AGENTS.md", "docs/README.md"];
  for (const dir of SECTIONS) {
    const names = existsSync(join(ROOT, dir)) ? await readdir(join(ROOT, dir)) : [];
    files.push(...names.filter((name) => name.endsWith(".md")).map((name) => `${dir}/${name}`));
  }
  return files;
}

/** Slug judul gaya GitHub: huruf kecil, buang tanda baca, spasi → `-`. */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

function anchors(markdown: string): Set<string> {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, "");
  return new Set([...withoutCode.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => slug(match[1] ?? "")));
}

/** Tautan `[teks](target)` dan gambar `![alt](target)` di luar blok kode. */
function links(markdown: string): string[] {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  return [...withoutCode.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((match) => match[1] ?? "");
}

describe("dokumentasi", () => {
  test("tautan relatif, gambar, dan anchor menunjuk ke yang ada", async () => {
    const broken: string[] = [];
    for (const file of await markdownFiles()) {
      const text = await readFile(join(ROOT, file), "utf8");
      for (const target of links(text)) {
        if (/^(https?:|mailto:)/.test(target)) continue;
        const [path = "", anchor] = target.split("#");
        const resolved = path === "" ? join(ROOT, file) : resolve(dirname(join(ROOT, file)), decodeURI(path));
        if (!existsSync(resolved)) {
          broken.push(`${file} → ${target}`);
          continue;
        }
        if (anchor !== undefined && anchor !== "" && resolved.endsWith(".md")) {
          if (!anchors(await readFile(resolved, "utf8")).has(anchor))
            broken.push(`${file} → ${target} (anchor)`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  test("setiap halaman fitur dan teknis terdaftar di docs/README.md", async () => {
    const index = await readFile(join(ROOT, "docs/README.md"), "utf8");
    const listed = new Set(links(index).map((target) => target.split("#")[0]));
    const pages = (await markdownFiles()).filter((file) =>
      SECTIONS.some((dir) => file.startsWith(`${dir}/`)),
    );
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.filter((page) => !listed.has(relative("docs", page)))).toEqual([]);
  });
});
