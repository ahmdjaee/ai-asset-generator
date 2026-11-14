/** Helper bersama `eval:base` dan `eval:texture`: menunggu result, menulis JSONL, menyalin hasil versi, mengukur konteks. */
import { appendFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import type { SDKMessage } from "../../server/agent/port.ts";
import { dockerCli, JOB_LABEL, OWNER_LABEL } from "../../server/runtime/docker.ts";
import { listVersions, versionDir } from "../../server/services/versions.ts";
import type { AgentEvent } from "../../shared/agent-events.ts";

export const EVAL_OWNER = "eval";

export function waitForResult(
  events: AgentEvent[],
  from: number,
  timeoutMs: number,
): Promise<"result" | "timeout"> {
  return new Promise((done) => {
    const started = Date.now();
    const check = () => {
      if (events.slice(from).some((event) => event.type === "result")) done("result");
      else if (Date.now() - started > timeoutMs) done("timeout");
      else setTimeout(check, 250);
    };
    check();
  });
}

export async function leftoverEvalContainers(): Promise<string[]> {
  const listed = await dockerCli([
    "ps",
    "-aq",
    "--filter",
    `label=${JOB_LABEL}`,
    "--filter",
    `label=${OWNER_LABEL}=${EVAL_OWNER}`,
  ]);
  return listed.stdout.split("\n").filter((line) => line.trim() !== "");
}

/** Penulis baris JSONL berurutan; error ditulis ke stderr, tidak menghentikan eval. */
export function jsonlWriter(path: string): (value: unknown) => void {
  let chain: Promise<void> = Promise.resolve();
  return (value) => {
    chain = chain
      .then(() => appendFile(path, `${JSON.stringify(value)}\n`))
      .catch((error: unknown) => console.error(`gagal menulis ${path}:`, error));
  };
}

/** Menyalin contact sheet, statistik, dan skrip setiap versi ke folder kasus (versi `from` ke atas). */
export async function collectArtifacts(caseDir: string, assetDir: string, from = 1): Promise<void> {
  for (const version of (await listVersions(assetDir)).filter((item) => item >= from)) {
    const files: Array<[string, string]> = [
      [join(assetDir, "derived", `v${version}`, "contact-sheet.png"), `contact-sheet-v${version}.png`],
      [join(versionDir(assetDir, version), "stats.json"), `stats-v${version}.json`],
      [join(versionDir(assetDir, version), "script.py"), `script-v${version}.py`],
    ];
    for (const [source, name] of files) await copyFile(source, join(caseDir, name)).catch(() => undefined);
  }
}

export type ContextMeter = Readonly<{
  observe: (message: SDKMessage) => void;
  /** Token konteks terbesar (input + cache) di satu panggilan model, dan jumlah panggilan. */
  read: () => { maxContextTokens: number; calls: number };
}>;

/** Ukuran konteks dari `usage` pesan assistant (bagian input sudah final walau pesan masih streaming). */
export function contextMeter(): ContextMeter {
  let maxContextTokens = 0;
  const ids = new Set<string>();
  return {
    observe: (message) => {
      if (message.type !== "assistant" || message.parent_tool_use_id !== null) return;
      const usage = message.message.usage;
      const total =
        usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
      maxContextTokens = Math.max(maxContextTokens, total);
      ids.add(message.message.id);
    },
    read: () => ({ maxContextTokens, calls: ids.size }),
  };
}
