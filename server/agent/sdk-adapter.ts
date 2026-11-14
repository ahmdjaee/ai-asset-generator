import { type AccountInfo, type Query, query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { agentEnv } from "../config.ts";
import { InputQueue } from "./input-queue.ts";
import type { AgentOptions, AgentPort, AgentSession, InterruptReceipt } from "./port.ts";

/**
 * Satu-satunya file yang meng-import `query` dari Agent SDK (AGENTS.md §6).
 * Kode lain memakai `AgentPort`; opsi sesi berasal dari `options.ts`.
 */

export type { AccountInfo };

/** Kuitansi interrupt mentah dari CLI (snake_case). */
type RawReceipt = { cancelled?: unknown; still_queued?: unknown };

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

/**
 * `Query.interrupt({ cancelQueued })`: argumennya belum tercantum di sdk.d.ts, tetapi diteruskan oleh sdk.mjs
 * (quirk yang sama di ai-team). Cast dibatasi di sini saja.
 */
async function interruptAll(instance: Query): Promise<InterruptReceipt | undefined> {
  const interrupt = instance.interrupt as unknown as (options: { cancelQueued: boolean }) => Promise<unknown>;
  const raw: unknown = await interrupt.call(instance, { cancelQueued: true }).catch(() => undefined);
  if (typeof raw !== "object" || raw === null) return undefined;
  const receipt: RawReceipt = raw;
  return { cancelled: stringList(receipt.cancelled), stillQueued: stringList(receipt.still_queued) };
}

class SdkSession implements AgentSession {
  readonly #input = new InputQueue<SDKUserMessage>();
  readonly #query: Query;

  constructor(options: AgentOptions) {
    this.#query = query({ prompt: this.#input, options });
  }

  get messages(): Query {
    return this.#query;
  }

  send(message: SDKUserMessage): void {
    this.#input.push(message);
  }

  interrupt(): Promise<InterruptReceipt | undefined> {
    return interruptAll(this.#query);
  }

  close(): void {
    if (!this.#input.ended) this.#input.end();
    try {
      this.#query.close();
    } catch {
      // Proses mungkin sudah berhenti sendiri.
    }
  }

  accountInfo(): Promise<AccountInfo> {
    return this.#query.accountInfo();
  }

  supportedModels() {
    return this.#query.supportedModels();
  }
}

export const sdkAgentPort: AgentPort = {
  start: (options) => new SdkSession(options),
};

/** Identitas sesi yang dipakai SDK. Bukti bahwa sesi login Claude Code terpakai, bukan API key. */
export async function readAccountInfo(): Promise<AccountInfo> {
  // Sesi tanpa pesan: proses Claude Code hidup untuk `accountInfo()`, tanpa memanggil model.
  const session = sdkAgentPort.start({
    disallowedTools: ["*"],
    settingSources: [],
    persistSession: false,
    env: agentEnv(),
  });
  try {
    return await session.accountInfo();
  } finally {
    session.close();
  }
}
