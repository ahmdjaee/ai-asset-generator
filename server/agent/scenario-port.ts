/**
 * Agent berskenario untuk `AGENT_DRIVER=fake` (port `FakeQuery` dari ai-team `scripts/check-runner.ts`): berperan
 * sebagai Claude Code tanpa proses Claude dan tanpa kuota.
 * - Tiap pesan menjalankan satu giliran skenario (DSL `ScenarioActions`), satu per satu sesuai urutan kiriman.
 * - Tool dipanggil lewat jalur yang sama dengan CLI asli: hook PreToolUse (pagar lapis 3), `canUseTool` (lapis 2,
 *   untuk tool bawaan dan AskUserQuestion), dan server MCP `forge` dari opsi sesi (InMemoryTransport).
 * - Keluarannya pesan SDK sungguhan: `init`, delta, assistant (teks/berpikir/tool_use), tool_result, `rate_limit_event`,
 *   dan `result` dengan `user_message_uuids`.
 * - Interrupt membatalkan giliran berjalan (permintaan MCP ikut dibatalkan) dan pesan yang masih antre.
 */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AskQuestion } from "../../shared/agent-events.ts";
import {
  assistantMessage,
  deltaMessage,
  initMessage,
  rateLimitMessage,
  resultMessage,
  text,
  thinking,
  toolResultMessage,
  toolUse,
} from "./fake-messages.ts";
import { FORGE_TOOL_TIMEOUT_MS } from "./forge/server.ts";
import { FORGE_SERVER } from "./guard.ts";
import { InputQueue } from "./input-queue.ts";
import type {
  AccountInfo,
  AgentOptions,
  AgentPort,
  AgentSession,
  InterruptReceipt,
  ModelInfo,
  SDKMessage,
  SDKUserMessage,
} from "./port.ts";

export const SCENARIO_MODEL = "claude-opus-5-5";
/** Akun palsu mode `AGENT_DRIVER=fake` (placeholder, bukan data pemilik). */
export const SCENARIO_EMAIL = "pemilik@contoh.invalid";

export type ScenarioTurn = Readonly<{ text: string; index: number }>;

/** Hasil tool `forge`: isi JSON (atau `{ raw }` untuk teks non-JSON), jumlah gambar, dan apakah error. */
export type ForgeReply = Readonly<{ ok: boolean; body: Readonly<Record<string, unknown>>; images: number }>;

/** Aksi "Claude" di dalam satu giliran skenario. Setiap aksi gagal dengan `ScenarioInterrupted` setelah Stop. */
export interface ScenarioActions {
  /** Folder kerja sesi (`cwd`), tempat `base.py` dan `material.py`. */
  readonly cwd: string;
  say(value: string): void;
  think(value: string): void;
  /** Teks yang masih ditulis: hanya delta stream, tanpa pesan utuh (mis. sebelum `hang()`). */
  streamText(value: string): void;
  /** Tool Write (path absolut). `false` bila ditolak pagar. */
  write(path: string, content: string): Promise<boolean>;
  /** Tool `mcp__forge__<name>`. */
  forge(name: string, args?: Record<string, unknown>): Promise<ForgeReply>;
  /** AskUserQuestion: jawaban pemilik per teks pertanyaan, atau `null` bila dibatalkan. */
  ask(questions: readonly AskQuestion[]): Promise<Readonly<Record<string, string>> | null>;
  /** Batas pemakaian tercapai: `rate_limit_event` ditolak, lalu giliran gagal. */
  usageLimit(resetsAt?: number): never;
  /** Menunggu sampai giliran di-interrupt (untuk tes Stop). */
  hang(): Promise<never>;
  /** Proses Claude mati: aliran pesan berakhir dengan error. */
  crash(message?: string): never;
  /** Claude Code belum login: pesan assistant ber-`error: authentication_failed`, giliran gagal. */
  loggedOut(): never;
}

export type Scenario = (turn: ScenarioTurn, claude: ScenarioActions) => Promise<void>;

export class ScenarioInterrupted extends Error {
  constructor() {
    super("Giliran di-interrupt");
    this.name = "ScenarioInterrupted";
  }
}

class UsageLimitSignal extends Error {
  readonly resetsAt: number | undefined;

  constructor(resetsAt: number | undefined) {
    super("batas pemakaian");
    this.resetsAt = resetsAt;
  }
}

class CrashSignal extends Error {}

class LoggedOutSignal extends Error {}

const Answers = z.record(z.string(), z.string());

type ToolContent = Parameters<typeof toolResultMessage>[2];

/** Potongan delta streaming: teks dibagi ±3 bagian supaya UI streaming ikut teruji. */
function chunks(value: string): string[] {
  const size = Math.max(1, Math.ceil(value.length / 3));
  const parts: string[] = [];
  for (let start = 0; start < value.length; start += size) parts.push(value.slice(start, start + size));
  return parts;
}

export class ScenarioSession implements AgentSession {
  readonly options: AgentOptions;
  readonly sessionId: string;
  readonly #scenario: Scenario;
  readonly #out = new InputQueue<SDKMessage>();
  readonly #pending: SDKUserMessage[] = [];
  #wake: (() => void) | undefined;
  #current: AbortController | undefined;
  #closed = false;
  #failure: Error | undefined;
  #initSent = false;
  #turns = 0;
  #toolIds = 0;
  #client: Promise<Client> | undefined;

  constructor(options: AgentOptions, scenario: Scenario) {
    this.options = options;
    this.#scenario = scenario;
    // Sesi lanjutan memakai id lama, seperti `resume` di Claude Code.
    this.sessionId = options.resume ?? randomUUID();
    void this.#loop().catch((error: unknown) => this.#fail(error));
  }

  get messages(): AsyncIterable<SDKMessage> {
    const out = this.#out;
    const session = this;
    return {
      async *[Symbol.asyncIterator]() {
        for await (const message of out) yield message;
        const failure = session.#failure;
        if (failure !== undefined) throw failure;
      },
    };
  }

  send(message: SDKUserMessage): void {
    if (this.#closed) return;
    this.#pending.push(message);
    this.#wakeLoop();
  }

  async interrupt(): Promise<InterruptReceipt | undefined> {
    const cancelled = this.#pending.splice(0).map((message) => message.uuid ?? "");
    this.#current?.abort();
    return { cancelled, stillQueued: [] };
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#pending.splice(0);
    this.#current?.abort();
    if (!this.#out.ended) this.#out.end();
    this.#wakeLoop();
    void this.#client?.then((client) => client.close()).catch(() => undefined);
  }

  async accountInfo(): Promise<AccountInfo> {
    // Alamat placeholder (domain .invalid), bukan data pemilik.
    return { email: SCENARIO_EMAIL, subscriptionType: "max", tokenSource: "fake" };
  }

  async supportedModels(): Promise<ModelInfo[]> {
    return [
      {
        value: SCENARIO_MODEL,
        displayName: "Opus 5.5",
        description: "Model palsu (AGENT_DRIVER=fake)",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
      },
      {
        value: "claude-sonnet-5-5",
        displayName: "Sonnet 5.5",
        description: "Model palsu (AGENT_DRIVER=fake)",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high"],
      },
    ];
  }

  #wakeLoop(): void {
    const wake = this.#wake;
    this.#wake = undefined;
    wake?.();
  }

  #emit(message: SDKMessage): void {
    if (!this.#out.ended) this.#out.push(message);
  }

  #fail(error: unknown): void {
    this.#failure = error instanceof Error ? error : new Error(String(error));
    this.#closed = true;
    if (!this.#out.ended) this.#out.end();
  }

  async #loop(): Promise<void> {
    for (;;) {
      const next = this.#pending.shift();
      if (next !== undefined) {
        await this.#turn(next);
        continue;
      }
      if (this.#closed) return;
      await new Promise<void>((resolve) => {
        this.#wake = resolve;
      });
    }
  }

  async #turn(message: SDKUserMessage): Promise<void> {
    const uuid = message.uuid ?? randomUUID();
    if (!this.#initSent) {
      this.#initSent = true;
      this.#emit(initMessage(this.sessionId, this.options.model ?? SCENARIO_MODEL));
    }
    const controller = new AbortController();
    this.#current = controller;
    this.#turns += 1;
    const content = message.message.content;
    const turnText =
      typeof content === "string"
        ? content
        : content.map((block) => (block.type === "text" ? block.text : "")).join("\n");
    try {
      await this.#scenario({ text: turnText, index: this.#turns }, this.#actions(controller.signal));
      this.#emit(resultMessage(this.sessionId, [uuid]));
    } catch (error) {
      if (error instanceof CrashSignal) {
        this.#fail(new Error(error.message));
        return;
      }
      if (error instanceof UsageLimitSignal) {
        this.#emit(rateLimitMessage(this.sessionId, "rejected", error.resetsAt));
      } else if (error instanceof LoggedOutSignal) {
        // Bentuk pesan CLI saat belum login (teks bahasa Inggris + `error`).
        this.#emit(
          assistantMessage(this.sessionId, [text("Not logged in · Please run /login")], {
            error: "authentication_failed",
          }),
        );
      } else if (!(error instanceof ScenarioInterrupted) && !controller.signal.aborted) {
        // Bug skenario: terlihat di thread supaya tes mudah dilacak.
        this.#emit(assistantMessage(this.sessionId, [text(`Skenario gagal: ${String(error)}`)]));
      }
      this.#emit(resultMessage(this.sessionId, [uuid], { subtype: "error_during_execution" }));
    } finally {
      this.#current = undefined;
    }
  }

  #actions(signal: AbortSignal): ScenarioActions {
    const check = () => {
      if (signal.aborted) throw new ScenarioInterrupted();
    };
    return {
      cwd: this.options.cwd ?? "",
      say: (value) => {
        check();
        for (const part of chunks(value)) this.#emit(deltaMessage(this.sessionId, "text", part));
        this.#emit(assistantMessage(this.sessionId, [text(value)]));
      },
      think: (value) => {
        check();
        for (const part of chunks(value)) this.#emit(deltaMessage(this.sessionId, "thinking", part));
        this.#emit(assistantMessage(this.sessionId, [thinking(value)]));
      },
      streamText: (value) => {
        check();
        for (const part of chunks(value)) this.#emit(deltaMessage(this.sessionId, "text", part));
      },
      write: async (path, content) => {
        check();
        return this.#write(path, content, signal);
      },
      forge: async (name, args = {}) => {
        check();
        return this.#forge(name, args, signal);
      },
      ask: async (questions) => {
        check();
        return this.#ask(questions, signal);
      },
      usageLimit: (resetsAt) => {
        throw new UsageLimitSignal(resetsAt);
      },
      hang: () =>
        new Promise<never>((_resolve, reject) => {
          if (signal.aborted) reject(new ScenarioInterrupted());
          else signal.addEventListener("abort", () => reject(new ScenarioInterrupted()), { once: true });
        }),
      crash: (message = "proses Claude berhenti mendadak") => {
        throw new CrashSignal(message);
      },
      loggedOut: () => {
        throw new LoggedOutSignal("belum login");
      },
    };
  }

  /**
   * Pesan tool_use dikirim, lalu menunggu runner selesai memproses semua pesan sebelumnya. CLI asli mengirim pesan
   * assistant jauh sebelum meminta izin (`can_use_tool`) atau menjalankan tool; tanpa penantian ini kartu pertanyaan
   * dan event build tercatat sebelum thinking dan teks yang mendahuluinya.
   */
  async #toolCall(name: string, input: Record<string, unknown>): Promise<string> {
    this.#toolIds += 1;
    const id = `toolu_skenario_${this.#turns}_${this.#toolIds}`;
    this.#emit(assistantMessage(this.sessionId, [toolUse(id, name, input)]));
    await this.#out.drained();
    return id;
  }

  #toolResult(id: string, content: ToolContent, isError: boolean): void {
    this.#emit(toolResultMessage(this.sessionId, id, content, isError));
  }

  /** Hook PreToolUse dari opsi sesi (pagar lapis 3). Hasil: alasan penolakan, atau null. */
  async #preToolUse(
    toolName: string,
    input: Record<string, unknown>,
    toolUseId: string,
    signal: AbortSignal,
  ): Promise<string | null> {
    const hookInput: PreToolUseHookInput = {
      hook_event_name: "PreToolUse",
      tool_name: toolName,
      tool_input: input,
      tool_use_id: toolUseId,
      session_id: this.sessionId,
      transcript_path: "",
      cwd: this.options.cwd ?? "",
    };
    for (const matcher of this.options.hooks?.PreToolUse ?? []) {
      if (matcher.matcher !== undefined && !new RegExp(`^(${matcher.matcher})$`).test(toolName)) continue;
      for (const hook of matcher.hooks) {
        const output = await hook(hookInput, toolUseId, { signal });
        const specific = "hookSpecificOutput" in output ? output.hookSpecificOutput : undefined;
        if (specific?.hookEventName === "PreToolUse" && specific.permissionDecision === "deny") {
          return specific.permissionDecisionReason ?? "Ditolak hook PreToolUse";
        }
      }
    }
    return null;
  }

  /** `canUseTool` (pagar lapis 2). Hasil: alasan penolakan, atau null. */
  async #permission(
    toolName: string,
    input: Record<string, unknown>,
    toolUseId: string,
    signal: AbortSignal,
  ): Promise<string | null> {
    const canUseTool = this.options.canUseTool;
    if (canUseTool === undefined) return null;
    const decision = await canUseTool(toolName, input, {
      signal,
      toolUseID: toolUseId,
      requestId: randomUUID(),
    });
    // `null` = keputusan diserahkan ke CLI; agent palsu menolak (fail-closed).
    if (decision === null) return "Tanpa keputusan izin";
    return decision.behavior === "deny" ? decision.message : null;
  }

  async #write(path: string, content: string, signal: AbortSignal): Promise<boolean> {
    const input = { file_path: path, content };
    const id = await this.#toolCall("Write", input);
    const denied =
      (await this.#preToolUse("Write", input, id, signal)) ??
      (await this.#permission("Write", input, id, signal));
    if (denied !== null) {
      this.#toolResult(id, denied, true);
      return false;
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
    this.#toolResult(id, `File ditulis: ${path}`, false);
    return true;
  }

  async #ask(
    questions: readonly AskQuestion[],
    signal: AbortSignal,
  ): Promise<Readonly<Record<string, string>> | null> {
    const input = { questions };
    const id = await this.#toolCall("AskUserQuestion", input);
    const canUseTool = this.options.canUseTool;
    const decision =
      canUseTool === undefined
        ? null
        : await canUseTool("AskUserQuestion", input, { signal, toolUseID: id, requestId: randomUUID() });
    if (decision === null || decision.behavior === "deny") {
      this.#toolResult(id, decision?.message ?? "Pertanyaan tidak bisa ditampilkan.", true);
      if (signal.aborted) throw new ScenarioInterrupted();
      return null;
    }
    const answers = Answers.parse(decision.updatedInput?.answers ?? {});
    this.#toolResult(id, `Jawaban pemilik: ${JSON.stringify(answers)}`, false);
    return answers;
  }

  async #forgeClient(): Promise<Client> {
    this.#client ??= (async () => {
      const config = this.options.mcpServers?.[FORGE_SERVER];
      if (config === undefined || config.type !== "sdk" || !("instance" in config)) {
        throw new Error("server forge tidak dipasang di opsi sesi");
      }
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await config.instance.connect(serverTransport);
      const client = new Client({ name: "claude-skenario", version: "1.0.0" });
      await client.connect(clientTransport);
      return client;
    })();
    return this.#client;
  }

  async #forge(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ForgeReply> {
    const toolName = `mcp__${FORGE_SERVER}__${name}`;
    const id = await this.#toolCall(toolName, args);
    const denied = await this.#preToolUse(toolName, args, id, signal);
    if (denied !== null) {
      this.#toolResult(id, denied, true);
      return { ok: false, body: { code: "DENIED", message: denied }, images: 0 };
    }
    const client = await this.#forgeClient();
    const result = await client
      .callTool({ name, arguments: args }, CallToolResultSchema, { timeout: FORGE_TOOL_TIMEOUT_MS, signal })
      .then((value) => CallToolResultSchema.parse(value))
      .catch((error: unknown) => {
        if (!signal.aborted) throw error;
        this.#toolResult(id, "Dibatalkan.", true);
        throw new ScenarioInterrupted();
      });
    const content: Exclude<ToolContent, string> = [];
    let raw = "";
    for (const part of result.content) {
      if (part.type === "text") {
        raw = raw === "" ? part.text : raw;
        content.push({ type: "text", text: part.text });
      } else if (part.type === "image") {
        content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: part.data } });
      }
    }
    const isError = result.isError === true;
    this.#toolResult(id, content, isError);
    const parsed = raw.startsWith("{") ? z.record(z.string(), z.unknown()).safeParse(JSON.parse(raw)) : null;
    return {
      ok: !isError,
      body: parsed?.success === true ? parsed.data : { raw },
      images: content.filter((part) => part.type === "image").length,
    };
  }
}

/** Port agent berskenario: setiap `start()` = satu "proses Claude" baru dengan skenario yang sama. */
export class ScenarioAgentPort implements AgentPort {
  readonly sessions: ScenarioSession[] = [];
  readonly #scenario: Scenario;

  constructor(scenario: Scenario) {
    this.#scenario = scenario;
  }

  start(options: AgentOptions): ScenarioSession {
    const session = new ScenarioSession(options, this.#scenario);
    this.sessions.push(session);
    return session;
  }

  /** Sesi terakhir (untuk tes). */
  get current(): ScenarioSession {
    const session = this.sessions.at(-1);
    if (session === undefined) throw new Error("belum ada sesi");
    return session;
  }
}
