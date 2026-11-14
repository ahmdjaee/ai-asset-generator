import { describe, expect, test } from "bun:test";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { agentEnv } from "../config.ts";
import { ALWAYS_DENIED, BUILTIN_TOOLS } from "./guard.ts";
import { buildSessionOptions } from "./options.ts";

const roots = {
  workDir: "/data/assets/a1/work",
  refsDir: "/data/assets/a1/refs",
  knowledgeDir: "/repo/runtime/knowledge",
};

function options(extra: { resume?: string; env?: Record<string, string | undefined> } = {}) {
  return buildSessionOptions({
    roots,
    resolvedRoots: {
      cwd: roots.workDir,
      read: [roots.workDir, roots.refsDir, roots.knowledgeDir],
      write: [roots.workDir],
    },
    systemPromptAppend: "PERSONA",
    forge: createSdkMcpServer({ name: "forge", alwaysLoad: true, timeout: 600_000, tools: [] }),
    canUseTool: async () => ({ behavior: "deny", message: "x" }),
    env: { PATH: "/usr/bin", HOME: "/home/pemilik" },
    ...extra,
  });
}

/** Bagian opsi yang bisa diserialisasi (fungsi dan instance MCP dibuang). */
function serializable(value: ReturnType<typeof options>) {
  const { canUseTool, hooks, mcpServers, stderr, ...rest } = value;
  return {
    ...rest,
    hasCanUseTool: typeof canUseTool === "function",
    hookEvents: Object.keys(hooks ?? {}),
    mcpServers: Object.fromEntries(
      Object.entries(mcpServers ?? {}).map(([name, config]) => [
        name,
        { type: config.type, name: "name" in config ? config.name : name },
      ]),
    ),
  };
}

describe("buildSessionOptions", () => {
  test("snapshot opsi sesi", () => {
    expect(serializable(options())).toMatchSnapshot();
  });

  test("allowlist tool tepat; Bash, web, subagent tidak pernah ada", () => {
    const value = options();
    expect(value.tools).toEqual([...BUILTIN_TOOLS]);
    for (const banned of ["Bash", "WebFetch", "WebSearch", "Task", "Agent", "NotebookEdit"]) {
      expect(value.tools).not.toContain(banned);
      expect(value.disallowedTools).toContain(banned);
    }
    expect(value.disallowedTools).toEqual([...ALWAYS_DENIED]);
  });

  test("tanpa setting milik mesin: settingSources kosong, strictMcpConfig, mode izin eksplisit", () => {
    const value = options();
    expect(value.settingSources).toEqual([]);
    expect(value.strictMcpConfig).toBe(true);
    expect(value.permissionMode).toBe("default");
  });

  test("berpikir diringkas dan effort eksplisit", () => {
    expect(options()).toMatchObject({
      thinking: { type: "adaptive", display: "summarized" },
      effort: "high",
    });
  });

  test("env bawaan dari agentEnv(): tanpa API key", () => {
    const original = { ...process.env };
    process.env.ANTHROPIC_API_KEY = "sk-palsu";
    process.env.ANTHROPIC_AUTH_TOKEN = "token-palsu";
    try {
      const { env } = buildSessionOptions({
        roots,
        resolvedRoots: { cwd: roots.workDir, read: [], write: [] },
        systemPromptAppend: "",
        forge: createSdkMcpServer({ name: "forge", tools: [] }),
        canUseTool: async () => ({ behavior: "deny", message: "x" }),
      });
      expect(env?.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env?.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      expect(env?.CLAUDE_AGENT_SDK_CLIENT_APP).toBe(agentEnv().CLAUDE_AGENT_SDK_CLIENT_APP);
      expect(env?.PATH).toBe(process.env.PATH);
    } finally {
      process.env.ANTHROPIC_API_KEY = original.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_AUTH_TOKEN = original.ANTHROPIC_AUTH_TOKEN;
      if (original.ANTHROPIC_API_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
      if (original.ANTHROPIC_AUTH_TOKEN === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
    }
  });

  test("resume hanya diisi bila ada session id", () => {
    expect(options()).not.toHaveProperty("resume");
    expect(options({ resume: "S1" }).resume).toBe("S1");
  });
});
