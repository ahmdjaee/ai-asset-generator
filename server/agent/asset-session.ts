/**
 * Merakit sesi Claude untuk satu aset: folder kerja, pagar, tool `forge`, opsi sesi, dan runner.
 * Dipakai service aset (lewat port `AssetAgent`) dan skrip `eval:base`/`eval:texture`.
 * - Status aset dibaca/diubah lewat `store` (database + `transition()`); pesan yang terkirim = giliran baru
 *   (`turn_started`, jatah build direset).
 * - `deliver()` menyusun teks pesan dari efek `transition()`; sesi baru pada aset yang sudah berjalan diberi
 *   pembuka berisi ringkasan keadaan aset.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "../../shared/agent-events.ts";
import type { AnswerResult, AnswerSubmission } from "../domain/answers.ts";
import type { Outbound, OutboundContext } from "../domain/status.ts";
import type { MaterialLibrary } from "../library/materials.ts";
import { KNOWLEDGE_DIR } from "../runtime/image.ts";
import type { AssetBuilder } from "./forge/builder.ts";
import { Forge } from "./forge/server.ts";
import type { ForgeAsset, ForgeStore } from "./forge/state.ts";
import { type AgentRoots, checkToolUse, resolveRoots } from "./guard.ts";
import { buildSessionOptions } from "./options.ts";
import type { AgentPool } from "./pool.ts";
import type { AgentPort } from "./port.ts";
import { outboundOrigin, outboundText, sessionPreamble, systemPromptAppend } from "./prompts.ts";
import { AssetRunner, type Schedule } from "./runner.ts";

export type AssetSessionOptions = Readonly<{
  asset: ForgeAsset;
  store: ForgeStore;
  port: AgentPort;
  builder: AssetBuilder;
  library: MaterialLibrary;
  emit: (event: AgentEvent) => void;
  model?: string;
  effort?: EffortLevel;
  /** Session id lama untuk resume. */
  sessionId?: string;
  /** Bawaan: `runtime/knowledge`. */
  knowledgeDir?: string;
  stderr?: (data: string) => void;
  pool?: AgentPool;
  schedule?: Schedule;
  newJobId?: () => string;
  /** Error teknis sesi untuk log server (lihat `RunnerOptions.onError`). */
  onError?: (error: unknown, op: string) => void;
}>;

export type AssetSession = Readonly<{
  runner: AssetRunner;
  forge: Forge;
  roots: AgentRoots;
  readonly sessionId: string | undefined;
  /** Pesan yang belum terkirim ke Claude. */
  readonly queued: number;
  /** Mengirim efek `deliver` dari `transition()` sebagai pesan ke Claude. */
  deliver(message: Outbound, context?: OutboundContext): void;
  interrupt(): Promise<void>;
  answer(questionId: string, submission: AnswerSubmission): AnswerResult;
  close(): void;
}>;

export async function createAssetSession(options: AssetSessionOptions): Promise<AssetSession> {
  const roots: AgentRoots = {
    workDir: join(options.asset.assetDir, "work"),
    refsDir: join(options.asset.assetDir, "refs"),
    knowledgeDir: options.knowledgeDir ?? KNOWLEDGE_DIR,
  };
  await mkdir(roots.workDir, { recursive: true });
  await mkdir(roots.refsDir, { recursive: true });
  const resolvedRoots = await resolveRoots(roots);
  const forge = new Forge({
    asset: options.asset,
    store: options.store,
    builder: options.builder,
    library: options.library,
    emit: options.emit,
    ...(options.newJobId === undefined ? {} : { newJobId: options.newJobId }),
  });
  const append = systemPromptAppend({
    tierId: options.asset.tierId,
    tier: options.asset.tier,
    knowledgeDir: roots.knowledgeDir,
    refsDir: roots.refsDir,
  });
  const runner = new AssetRunner({
    port: options.port,
    // Server MCP dibuat baru per proses Claude: instance MCP tidak bisa dipakai dua transport.
    sessionOptions: ({ resume, canUseTool }) =>
      buildSessionOptions({
        roots,
        resolvedRoots,
        systemPromptAppend: append,
        forge: forge.mcpServer(),
        canUseTool,
        ...(options.model === undefined ? {} : { model: options.model }),
        ...(options.effort === undefined ? {} : { effort: options.effort }),
        ...(resume === undefined ? {} : { resume }),
        ...(options.stderr === undefined ? {} : { stderr: options.stderr }),
      }),
    checkTool: (toolName, input) => checkToolUse(toolName, input, resolvedRoots),
    emit: options.emit,
    onOwnerMessage: () => {
      options.store.apply({ type: "turn_started" });
    },
    onStop: () => forge.cancelActive(),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
    ...(options.pool === undefined ? {} : { pool: options.pool }),
    ...(options.schedule === undefined ? {} : { schedule: options.schedule }),
  });
  let preambleQueued = false;
  return {
    runner,
    forge,
    roots,
    get sessionId() {
      return runner.sessionId;
    },
    get queued() {
      return runner.queued;
    },
    deliver: (message, context = {}) => {
      let text = outboundText(message, context, roots.refsDir);
      if (runner.sessionId === undefined && !preambleQueued) {
        preambleQueued = true;
        const preamble = sessionPreamble(options.store.read());
        if (preamble !== null) text = `${preamble}\n\n${text}`;
      }
      const origin = outboundOrigin(message);
      if (message.kind === "owner") {
        // Thread menampilkan kata-kata pemilik + chip lampiran; Claude menerima teks lengkap.
        const attachments = (message.attachments ?? []).map(({ id, kind, name }) => ({ id, kind, name }));
        runner.send(text, { display: message.text, attachments });
      } else {
        runner.send(text, origin === undefined ? {} : { origin });
      }
    },
    interrupt: () => runner.interrupt(),
    answer: (questionId, submission) => runner.answer(questionId, submission),
    // Build yang sedang berjalan ikut dibatalkan (container di-kill), tidak bergantung pada transport MCP yang
    // tertutup bersama proses Claude.
    close: () => {
      forge.cancelActive();
      runner.close();
    },
  };
}
