/**
 * Pagar akses file dan tool untuk Claude (lapis 2 dan 3 dari AGENTS.md §6; lapis 1 = allowlist `tools`).
 * - Read/Glob/Grep: hanya di `work/`, `refs/`, dan `runtime/knowledge/`.
 * - Write/Edit: hanya di `work/`.
 * - Selain tool yang diizinkan: selalu ditolak.
 * Path dicek dengan `realpath`, jadi symlink yang menunjuk ke luar ikut tertangkap.
 */
import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import type { HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

/** Tool bawaan Claude Code yang tersedia di sesi (lapis 1). */
export const BUILTIN_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "TodoWrite",
  "AskUserQuestion",
] as const;
export const FORGE_SERVER = "forge";
export const FORGE_TOOL_PREFIX = `mcp__${FORGE_SERVER}__`;
/** Selalu ditolak, apa pun lapisannya. `mcp__claude_ai_*` = konektor akun claude.ai yang bisa ikut menempel. */
export const ALWAYS_DENIED = [
  "Bash",
  "WebFetch",
  "WebSearch",
  "Task",
  "Agent",
  "NotebookEdit",
  "mcp__claude_ai_*",
] as const;

export type AgentRoots = Readonly<{
  /** `data/assets/<id>/work`: cwd sesi, satu-satunya folder yang boleh ditulis. */
  workDir: string;
  /** `data/assets/<id>/refs`: lampiran pemilik, hanya dibaca. */
  refsDir: string;
  /** `runtime/knowledge`: referensi assetkit dan cookbook, hanya dibaca. */
  knowledgeDir: string;
}>;

/** Root yang sudah di-`realpath`; dibuat sekali per sesi dengan `resolveRoots`. */
export type ResolvedRoots = Readonly<{ cwd: string; read: readonly string[]; write: readonly string[] }>;

export type GuardVerdict = Readonly<{ allow: true }> | Readonly<{ allow: false; reason: string }>;

const ALLOW: GuardVerdict = { allow: true };
const deny = (reason: string): GuardVerdict => ({ allow: false, reason });

export async function resolveRoots(roots: AgentRoots): Promise<ResolvedRoots> {
  const [work, refs, knowledge] = await Promise.all([
    realpath(roots.workDir),
    realpath(roots.refsDir),
    realpath(roots.knowledgeDir),
  ]);
  return { cwd: work, read: [work, refs, knowledge], write: [work] };
}

function isInside(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

/**
 * Path nyata untuk `path` (relatif ke `cwd`), termasuk file yang belum ada: leluhur terdalam yang ada di-`realpath`,
 * sisanya ditempel. Symlink yang menggantung ditolak, karena Write akan mengikutinya ke luar.
 */
export async function realTarget(path: string, cwd: string): Promise<string | null> {
  const absolute = resolve(cwd, path);
  let current = absolute;
  for (;;) {
    try {
      const real = await realpath(current);
      return current === absolute ? real : resolve(real, absolute.slice(current.length + 1));
    } catch (error) {
      if (errorCode(error) !== "ENOENT" && errorCode(error) !== "ENOTDIR") return null;
      const exists = await lstat(current).then(
        () => true,
        () => false,
      );
      if (exists) return null;
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

async function checkPath(path: unknown, roots: ResolvedRoots, mode: "read" | "write"): Promise<GuardVerdict> {
  if (typeof path !== "string" || path.trim() === "" || path.includes("\0")) return deny("path tidak valid");
  const target = await realTarget(path, roots.cwd);
  const allowed = mode === "read" ? roots.read : roots.write;
  if (target !== null && allowed.some((root) => isInside(target, root))) return ALLOW;
  return mode === "read"
    ? deny(`hanya boleh membaca di work/, refs/, dan knowledge/ (${path})`)
    : deny(`hanya boleh menulis di work/ (${path})`);
}

/** Pola glob tidak boleh keluar dari folder dasarnya. */
function checkPattern(pattern: unknown): GuardVerdict {
  if (pattern === undefined) return ALLOW;
  if (typeof pattern !== "string") return deny("pola tidak valid");
  if (isAbsolute(pattern) || pattern.startsWith("~") || pattern.split(/[\\/]/).includes("..")) {
    return deny(`pola glob harus relatif dan tanpa '..' (${pattern})`);
  }
  return ALLOW;
}

const FileInput = z.object({ file_path: z.unknown() });
const SearchInput = z.object({
  path: z.unknown().optional(),
  pattern: z.unknown(),
  glob: z.unknown().optional(),
});

function firstDenied(verdicts: readonly GuardVerdict[]): GuardVerdict {
  return verdicts.find((verdict) => !verdict.allow) ?? ALLOW;
}

/** Keputusan untuk satu pemanggilan tool. Dipakai hook PreToolUse dan `canUseTool`. */
export async function checkToolUse(
  toolName: string,
  input: unknown,
  roots: ResolvedRoots,
): Promise<GuardVerdict> {
  if (toolName.startsWith(FORGE_TOOL_PREFIX)) return ALLOW;
  switch (toolName) {
    case "TodoWrite":
    case "AskUserQuestion":
      return ALLOW;
    case "Read": {
      const parsed = FileInput.safeParse(input);
      return parsed.success
        ? checkPath(parsed.data.file_path, roots, "read")
        : deny("input Read tidak valid");
    }
    case "Write":
    case "Edit": {
      const parsed = FileInput.safeParse(input);
      return parsed.success
        ? checkPath(parsed.data.file_path, roots, "write")
        : deny(`input ${toolName} tidak valid`);
    }
    case "Glob":
    case "Grep": {
      const parsed = SearchInput.safeParse(input);
      if (!parsed.success) return deny(`input ${toolName} tidak valid`);
      const { path, pattern, glob } = parsed.data;
      return firstDenied([
        path === undefined ? ALLOW : await checkPath(path, roots, "read"),
        toolName === "Glob" ? checkPattern(pattern) : ALLOW,
        checkPattern(glob),
      ]);
    }
    default:
      return deny(`tool ${toolName} tidak tersedia di sesi ini`);
  }
}

/** Lapis 3: hook PreToolUse untuk semua tool. Berjalan sebelum aturan izin dan permission mode. */
export function guardHooks(roots: ResolvedRoots): { PreToolUse: HookCallbackMatcher[] } {
  return {
    PreToolUse: [
      {
        hooks: [
          async (input) => {
            if (input.hook_event_name !== "PreToolUse") return {};
            const verdict = await checkToolUse(input.tool_name, input.tool_input, roots);
            if (verdict.allow) return {};
            return {
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: `Ditolak pagar: ${verdict.reason}`,
              },
            };
          },
        ],
      },
    ],
  };
}

/** Bentuk `//abs/path`: aturan izin Claude Code untuk path absolut. */
function absRule(path: string): string {
  return `//${path.replace(/^\/+/, "")}/**`;
}

/** Lapis 2a: aturan izin eksplisit. `ask` sengaja kosong (dievaluasi sebelum `allow`). */
export function permissionRules(roots: AgentRoots): { allow: string[]; deny: string[] } {
  return {
    allow: [
      `Read(${absRule(roots.workDir)})`,
      `Read(${absRule(roots.refsDir)})`,
      `Read(${absRule(roots.knowledgeDir)})`,
      `Edit(${absRule(roots.workDir)})`,
      "TodoWrite",
      `${FORGE_TOOL_PREFIX}*`,
    ],
    deny: [...ALWAYS_DENIED],
  };
}
