/**
 * Tes kontrak terhadap stream SDK nyata yang direkam (`tests/fixtures/sdk/*.jsonl`, disanitasi).
 * Upgrade SDK = rekam ulang lewat `eval:base` + `scripts/sdk-fixture.ts`, lalu tes ini harus tetap lolos.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AgentEvent } from "../../shared/agent-events.ts";
import { resultMeta, toAgentEvents } from "./events.ts";
import { BUILTIN_TOOLS, FORGE_TOOL_PREFIX } from "./guard.ts";

const FIXTURE_DIR = join(import.meta.dir, "../../tests/fixtures/sdk");

const Envelope = z.object({ type: z.string(), session_id: z.string().optional() }).passthrough();

/**
 * Baris fixture adalah keluaran SDK sendiri; bentuk lengkapnya dicek oleh `toAgentEvents` dan asersi di bawah.
 * Cast dibatasi di sini: JSON dari disk tidak bisa dibuktikan bertipe `SDKMessage` tanpa skema SDK lengkap.
 */
function asSdkMessage(value: unknown): SDKMessage {
  return Envelope.parse(value) as unknown as SDKMessage;
}

async function load(name: string): Promise<SDKMessage[]> {
  const text = await readFile(join(FIXTURE_DIR, name), "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => asSdkMessage(JSON.parse(line)));
}

const InitTools = z.object({
  type: z.literal("system"),
  subtype: z.literal("init"),
  tools: z.array(z.string()),
  model: z.string(),
});

describe("kontrak stream SDK (rekaman eval:base)", () => {
  const files = readdirSync(FIXTURE_DIR)
    .filter((file) => file.endsWith(".jsonl"))
    .sort();

  test("ada minimal satu rekaman", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    test(`${file}: tool di sesi nyata = allowlist + forge; tanpa Bash dan tanpa konektor claude.ai`, async () => {
      const init = (await load(file)).find(
        (message) => message.type === "system" && "subtype" in message && message.subtype === "init",
      );
      const tools = InitTools.parse(init).tools;
      const builtins = tools.filter((tool) => !tool.startsWith("mcp__"));
      expect(builtins.every((tool) => (BUILTIN_TOOLS as readonly string[]).includes(tool))).toBe(true);
      expect(
        tools.filter((tool) => tool.startsWith("mcp__")).every((tool) => tool.startsWith(FORGE_TOOL_PREFIX)),
      ).toBe(true);
      expect(tools).toContain(`${FORGE_TOOL_PREFIX}build_base_mesh`);
      for (const banned of ["Bash", "WebFetch", "WebSearch", "Task", "Agent", "NotebookEdit"])
        expect(tools).not.toContain(banned);
    });

    test(`${file}: event app terbentuk (berpikir, tool, hasil tool bergambar, result dengan uuid)`, async () => {
      const messages = await load(file);
      const events: AgentEvent[] = messages.flatMap((message) => toAgentEvents(message));
      const types = new Set(events.map((event) => event.type));
      for (const type of ["init", "thinking", "tool", "tool_result", "assistant", "result"])
        expect(types.has(type as AgentEvent["type"])).toBe(true);
      expect(events.some((event) => event.type === "thinking" && event.text.trim().length > 20)).toBe(true);
      expect(events.some((event) => event.type === "tool_result" && event.images === 1)).toBe(true);
      const results = messages.flatMap((message) => {
        const meta = resultMeta(message);
        return meta === undefined ? [] : [meta];
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((meta) => meta.userMessageUuids.length > 0)).toBe(true);
    });

    test(`${file}: tanpa data pribadi`, async () => {
      const text = await readFile(join(FIXTURE_DIR, file), "utf8");
      expect(text).not.toMatch(/\/home\/(?!pemilik)[a-z]/);
      expect(
        text
          .match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)
          ?.filter((email) => email !== "pemilik@contoh.invalid") ?? [],
      ).toEqual([]);
    });
  }
});
