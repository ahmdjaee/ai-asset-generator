import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import {
  type AgentRoots,
  ALWAYS_DENIED,
  BUILTIN_TOOLS,
  checkToolUse,
  guardHooks,
  permissionRules,
  type ResolvedRoots,
  realTarget,
  resolveRoots,
} from "./guard.ts";

let base = "";
let roots: AgentRoots;
let resolved: ResolvedRoots;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "aag-guard-")));
  roots = {
    workDir: join(base, "asset", "work"),
    refsDir: join(base, "asset", "refs"),
    knowledgeDir: join(base, "knowledge"),
  };
  for (const dir of [
    roots.workDir,
    roots.refsDir,
    roots.knowledgeDir,
    join(base, "asset", "versions"),
    join(base, "luar"),
  ]) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(join(roots.workDir, "base.py"), "print(1)\n");
  await writeFile(join(roots.knowledgeDir, "API.md"), "# API\n");
  await writeFile(join(base, "luar", "rahasia.txt"), "rahasia\n");
  await symlink(join(base, "luar", "rahasia.txt"), join(roots.workDir, "tautan.txt"));
  await symlink(join(base, "luar"), join(roots.workDir, "folder-luar"));
  await symlink(join(base, "luar", "belum-ada", "x.py"), join(roots.workDir, "menggantung.py"));
  resolved = await resolveRoots(roots);
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

const check = (tool: string, input: unknown) => checkToolUse(tool, input, resolved);

describe("checkToolUse — tes penolakan wajib", () => {
  test("Read /etc/passwd ditolak", async () => {
    expect(await check("Read", { file_path: "/etc/passwd" })).toMatchObject({ allow: false });
  });

  test.each(["../versions/v1/base.glb", "../../luar/rahasia.txt", "sub/../../../luar/rahasia.txt"])(
    "traversal '../' ditolak: %p",
    async (path) => {
      expect(await check("Read", { file_path: path })).toMatchObject({ allow: false });
      expect(await check("Write", { file_path: path, content: "x" })).toMatchObject({ allow: false });
    },
  );

  test("symlink di work/ yang menunjuk ke luar ditolak untuk Read, Write, dan Edit", async () => {
    for (const tool of ["Read", "Write", "Edit"]) {
      expect(await check(tool, { file_path: join(roots.workDir, "tautan.txt") })).toMatchObject({
        allow: false,
      });
      expect(
        await check(tool, { file_path: join(roots.workDir, "folder-luar", "rahasia.txt") }),
      ).toMatchObject({
        allow: false,
      });
    }
  });

  test("symlink menggantung di work/ ditolak (Write akan membuat file di luar)", async () => {
    expect(await check("Write", { file_path: join(roots.workDir, "menggantung.py") })).toMatchObject({
      allow: false,
    });
  });

  test("Write dan Edit di luar work/ ditolak, termasuk refs/ dan knowledge/", async () => {
    for (const path of [
      "/tmp/x.py",
      join(roots.refsDir, "a.png"),
      join(roots.knowledgeDir, "API.md"),
      join(base, "asset", "x.py"),
    ]) {
      expect(await check("Write", { file_path: path })).toMatchObject({ allow: false });
      expect(await check("Edit", { file_path: path })).toMatchObject({ allow: false });
    }
  });

  test.each([
    ...ALWAYS_DENIED.filter((tool) => !tool.endsWith("*")),
    "mcp__claude_ai_Figma__get",
    "mcp__lain__x",
    "Skill",
  ])("tool di luar allowlist ditolak: %p", async (tool) => {
    expect(await check(tool, { command: "cat /etc/passwd" })).toMatchObject({ allow: false });
  });

  test("Bash tidak ada di allowlist tool, dan ada di aturan deny", () => {
    expect(BUILTIN_TOOLS).not.toContain("Bash");
    expect(permissionRules(roots).deny).toContain("Bash");
    expect(permissionRules(roots).deny).toContain("mcp__claude_ai_*");
  });

  test.each([
    ["Glob pola absolut", "Glob", { pattern: "/etc/*" }],
    ["Glob pola dengan ..", "Glob", { pattern: "../../**/*" }],
    ["Glob pola ~", "Glob", { pattern: "~/.ssh/*" }],
    ["Glob path di luar", "Glob", { pattern: "*", path: "/etc" }],
    ["Grep path di luar", "Grep", { pattern: "root", path: "/etc" }],
    ["Grep glob dengan ..", "Grep", { pattern: "x", glob: "../**" }],
  ])("%s ditolak", async (_label, tool, input) => {
    expect(await check(tool, input)).toMatchObject({ allow: false });
  });

  test.each([
    ["Read tanpa file_path", "Read", {}],
    ["Write path kosong", "Write", { file_path: "" }],
    ["Read path dengan NUL", "Read", { file_path: "a\0b" }],
    ["Read bukan objek", "Read", "x"],
  ])("input rusak ditolak: %s", async (_label, tool, input) => {
    expect(await check(tool, input)).toMatchObject({ allow: false });
  });
});

describe("checkToolUse — yang diizinkan", () => {
  test.each([
    ["Read skrip di work/", "Read", () => ({ file_path: join(roots.workDir, "base.py") })],
    ["Read relatif ke cwd", "Read", () => ({ file_path: "base.py" })],
    ["Read knowledge", "Read", () => ({ file_path: join(roots.knowledgeDir, "API.md") })],
    ["Read refs (file belum ada)", "Read", () => ({ file_path: join(roots.refsDir, "a.png") })],
    [
      "Write file baru di subfolder baru work/",
      "Write",
      () => ({ file_path: join(roots.workDir, "baru", "base.py") }),
    ],
    ["Edit base.py", "Edit", () => ({ file_path: join(roots.workDir, "base.py") })],
    ["Glob relatif", "Glob", () => ({ pattern: "**/*.md", path: roots.knowledgeDir })],
    ["Grep di knowledge", "Grep", () => ({ pattern: "box", path: roots.knowledgeDir, glob: "*.md" })],
    ["TodoWrite", "TodoWrite", () => ({ todos: [] })],
    ["AskUserQuestion", "AskUserQuestion", () => ({ questions: [] })],
    ["tool forge", "mcp__forge__build_base_mesh", () => ({})],
  ])("%s", async (_label, tool, input) => {
    expect(await check(tool, input())).toEqual({ allow: true });
  });
});

describe("realTarget", () => {
  test("file yang belum ada di folder yang belum ada → path nyata leluhurnya", async () => {
    expect(await realTarget("a/b/c.py", roots.workDir)).toBe(join(resolved.cwd, "a", "b", "c.py"));
  });

  test("symlink diikuti", async () => {
    expect(await realTarget("tautan.txt", roots.workDir)).toBe(join(base, "luar", "rahasia.txt"));
  });

  test("symlink menggantung → null", async () => {
    expect(await realTarget("menggantung.py", roots.workDir)).toBeNull();
  });
});

describe("guardHooks (lapis 3)", () => {
  function preToolUse(toolName: string, toolInput: unknown): HookInput {
    return {
      hook_event_name: "PreToolUse",
      tool_name: toolName,
      tool_input: toolInput,
      tool_use_id: "tu-1",
      session_id: "s",
      transcript_path: "/dev/null",
      cwd: roots.workDir,
    };
  }

  async function runHook(input: HookInput) {
    const hook = guardHooks(resolved).PreToolUse[0]?.hooks[0];
    if (hook === undefined) throw new Error("hook tidak ada");
    return hook(input, "tu-1", { signal: new AbortController().signal });
  }

  test("menolak Read /etc/passwd dengan permissionDecision deny", async () => {
    expect(await runHook(preToolUse("Read", { file_path: "/etc/passwd" }))).toMatchObject({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" },
    });
  });

  test("menolak Bash", async () => {
    expect(await runHook(preToolUse("Bash", { command: "ls" }))).toMatchObject({
      hookSpecificOutput: { permissionDecision: "deny" },
    });
  });

  test("meneruskan tool yang lolos tanpa keputusan (aturan izin tetap berlaku)", async () => {
    expect(await runHook(preToolUse("Read", { file_path: join(roots.workDir, "base.py") }))).toEqual({});
  });

  test("berlaku untuk semua tool (tanpa matcher)", () => {
    expect(guardHooks(resolved).PreToolUse[0]?.matcher).toBeUndefined();
  });
});

describe("permissionRules (lapis 2a)", () => {
  test("allow hanya path absolut aset dan knowledge; Edit hanya work/", () => {
    expect(permissionRules(roots)).toEqual({
      allow: [
        `Read(/${roots.workDir}/**)`,
        `Read(/${roots.refsDir}/**)`,
        `Read(/${roots.knowledgeDir}/**)`,
        `Edit(/${roots.workDir}/**)`,
        "TodoWrite",
        "mcp__forge__*",
      ],
      deny: [...ALWAYS_DENIED],
    });
  });
});
