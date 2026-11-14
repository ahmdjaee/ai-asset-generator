/**
 * Satu-satunya factory opsi sesi Claude (AGENTS.md §6). Semua sesi aset memakai fungsi ini.
 */
import type { CanUseTool, EffortLevel, McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { agentEnv } from "../config.ts";
import {
  type AgentRoots,
  ALWAYS_DENIED,
  BUILTIN_TOOLS,
  FORGE_SERVER,
  guardHooks,
  permissionRules,
  type ResolvedRoots,
} from "./guard.ts";
import type { AgentOptions } from "./port.ts";

export const DEFAULT_MODEL = "claude-opus-5-5";
/** Eksplisit: bawaan Opus 5.5 adalah `medium`. */
export const DEFAULT_EFFORT: EffortLevel = "high";

export type SessionOptionsInput = Readonly<{
  model?: string;
  effort?: EffortLevel;
  roots: AgentRoots;
  resolvedRoots: ResolvedRoots;
  /** Teks yang ditambahkan ke system prompt preset `claude_code` (persona, aturan, konteks aset). */
  systemPromptAppend: string;
  forge: McpSdkServerConfigWithInstance;
  canUseTool: CanUseTool;
  /** Session id untuk dilanjutkan (resume) setelah proses mati atau revisi. */
  resume?: string;
  stderr?: (data: string) => void;
  /** Bawaan: `agentEnv()` (tanpa API key). Hanya tes yang mengisinya. */
  env?: Record<string, string | undefined>;
}>;

export function buildSessionOptions(input: SessionOptionsInput): AgentOptions {
  return {
    model: input.model ?? DEFAULT_MODEL,
    effort: input.effort ?? DEFAULT_EFFORT,
    // Tanpa `display: "summarized"`, ringkasan berpikir kosong di Opus 5.x.
    thinking: { type: "adaptive", display: "summarized" },
    // Tanpa CLAUDE.md, settings, atau MCP milik pemilik di mesin ini.
    settingSources: [],
    strictMcpConfig: true,
    systemPrompt: { type: "preset", preset: "claude_code", append: input.systemPromptAppend },
    // Lapis 1: hanya tool ini yang ada di konteks Claude.
    tools: [...BUILTIN_TOOLS],
    disallowedTools: [...ALWAYS_DENIED],
    // Lapis 2: aturan izin + canUseTool yang menolak secara bawaan. Mode diatur eksplisit (bukan "auto").
    permissionMode: "default",
    settings: { permissions: { ...permissionRules(input.roots), disableBypassPermissionsMode: "disable" } },
    canUseTool: input.canUseTool,
    // Lapis 3: hook PreToolUse dengan realpath.
    hooks: guardHooks(input.resolvedRoots),
    mcpServers: { [FORGE_SERVER]: input.forge },
    includePartialMessages: true,
    cwd: input.roots.workDir,
    additionalDirectories: [input.roots.refsDir, input.roots.knowledgeDir],
    ...(input.resume === undefined ? {} : { resume: input.resume }),
    ...(input.stderr === undefined ? {} : { stderr: input.stderr }),
    env: input.env ?? agentEnv(),
  };
}
