/**
 * Runner sesi Claude untuk satu aset (port `TaskRunner` ai-team):
 * - pesan pemilik dikirim satu per satu, masing-masing dengan uuid sendiri;
 * - result dicocokkan ke pesan lewat `user_message_uuids`, bukan lewat urutan;
 * - proses Claude dimulai lewat pool (maks. 2 proses hidup) dan ditutup setelah idle 5 menit; sesi tetap bisa
 *   di-resume dari session id;
 * - Stop = interrupt (`cancelQueued`) → batalkan build → baru tutup kartu pertanyaan;
 * - pesan yang masih ter-buffer setelah sesi diganti atau ditutup diabaikan;
 * - AskUserQuestion dijembatani ke event `question`; jawaban pilih satu/banyak + "Lainnya" lewat `answer()`;
 * - batas pemakaian (`rate_limit_event` ditolak, atau teks `USAGE_LIMIT_ERROR_PREFIXES`) diputuskan di akhir
 *   giliran: giliran yang gagal karenanya menghasilkan error `USAGE_LIMIT` dengan waktu reset.
 * Waktu (timer) disuntikkan lewat `schedule`, jadi tes tidak memakai sleep.
 */
import { randomUUID } from "node:crypto";
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type {
  AgentEvent,
  AskQuestion,
  MessageAttachment,
  SystemMessageOrigin,
} from "../../shared/agent-events.ts";
import { AGENT_IDLE_SHUTDOWN_MS } from "../../shared/limits.ts";
import { type AnswerResult, type AnswerSubmission, formatAnswers } from "../domain/answers.ts";
import { resultMeta, toAgentEvents } from "./events.ts";
import type { GuardVerdict } from "./guard.ts";
import { type AgentPool, type Lease, PoolAbortedError, type PoolMember } from "./pool.ts";
import type { AgentOptions, AgentPort, AgentSession } from "./port.ts";

/** Batas tunggu result setelah Stop sebelum sesi ditutup paksa (bisa di-resume). */
export const STOP_GRACE_MS = 15_000;

export const QUEUED_NOTICE = "Menunggu giliran proses Claude (paling banyak 2 proses aktif bersamaan).";
export const USAGE_LIMIT_MESSAGE = "Batas pemakaian Claude tercapai.";
export const SESSION_START_FAILED_MESSAGE =
  "Proses Claude tidak bisa dimulai. Tekan Coba lagi; detailnya ada di log server.";
export const SESSION_CRASHED_MESSAGE = "Sesi Claude berhenti karena kesalahan. Detailnya ada di log server.";

export type RunnerStatus = "idle" | "running" | "waiting_user";

export type Timer = { cancel: () => void };
export type Schedule = (fn: () => void, ms: number) => Timer;

const defaultSchedule: Schedule = (fn, ms) => {
  const handle = setTimeout(fn, ms);
  handle.unref();
  return { cancel: () => clearTimeout(handle) };
};

export type RunnerOptions = Readonly<{
  port: AgentPort;
  /** Opsi sesi dari `buildSessionOptions`; dipanggil setiap kali proses Claude baru dimulai. */
  sessionOptions: (context: { resume?: string; canUseTool: CanUseTool }) => AgentOptions;
  /** Keputusan pagar untuk tool selain AskUserQuestion (lapis 2, menolak secara bawaan). */
  checkTool: (toolName: string, input: Record<string, unknown>) => Promise<GuardVerdict>;
  emit: (event: AgentEvent) => void;
  /** Dipanggil saat pesan benar-benar dikirim ke Claude (giliran baru: jatah build direset). */
  onOwnerMessage?: () => void;
  /** Dipanggil saat Stop: membatalkan build yang berjalan (`docker kill`). */
  onStop?: () => void;
  /**
   * Error teknis (proses Claude gagal dimulai atau mati). Detailnya untuk log server; pemilik hanya menerima pesan
   * umum (AGENTS §5: pesan ke klien berbahasa Indonesia, tanpa detail teknis).
   */
  onError?: (error: unknown, op: string) => void;
  /** Session id untuk resume sesi lama. */
  sessionId?: string;
  /** Pool proses Claude. Tanpa pool, proses langsung dimulai (skrip eval). */
  pool?: AgentPool;
  /** Proses idle ditutup setelah selang ini. */
  idleShutdownMs?: number;
  stopGraceMs?: number;
  schedule?: Schedule;
}>;

const AskInput = z.object({
  questions: z
    .array(
      z.object({
        question: z.string(),
        header: z.string(),
        options: z.array(z.object({ label: z.string(), description: z.string() })),
        multiSelect: z.boolean().default(false),
      }),
    )
    .min(1),
});

type PendingQuestion = {
  questions: readonly AskQuestion[];
  resolve: (answers: Readonly<Record<string, string>> | null) => void;
};
type Turn = { uuid: string; stopped: boolean };
type Outgoing = { uuid: ReturnType<typeof randomUUID>; text: string };
/** Tanda batas pemakaian selama giliran; diputuskan saat giliran berakhir. */
type UsageLimit = { fromText: boolean; resetsAt?: number; text?: string };

export class AssetRunner implements PoolMember {
  readonly #options: RunnerOptions;
  readonly #inbox: Outgoing[] = [];
  readonly #questions = new Map<string, PendingQuestion>();
  #session: AgentSession | undefined;
  #lease: Lease | undefined;
  /** Sedang meminta slot pool / memulai proses. */
  #starting = false;
  #slotRequest: AbortController | undefined;
  #turn: Turn | undefined;
  #sessionId: string | undefined;
  #status: RunnerStatus = "idle";
  #closed = false;
  #stopGrace: Timer | undefined;
  #idleTimer: Timer | undefined;
  #usageLimit: UsageLimit | undefined;

  constructor(options: RunnerOptions) {
    this.#options = options;
    this.#sessionId = options.sessionId;
  }

  get sessionId(): string | undefined {
    return this.#sessionId;
  }

  get status(): RunnerStatus {
    return this.#status;
  }

  get openQuestions(): string[] {
    return [...this.#questions.keys()];
  }

  /** Pesan yang belum terkirim ke Claude (menunggu giliran atau slot pool). */
  get queued(): number {
    return this.#inbox.length;
  }

  /** Ada proses Claude yang hidup untuk aset ini. */
  get live(): boolean {
    return this.#session !== undefined;
  }

  get evictable(): boolean {
    return (
      this.#session !== undefined &&
      this.#turn === undefined &&
      !this.#starting &&
      this.#inbox.length === 0 &&
      this.#questions.size === 0
    );
  }

  /** Dipanggil pool: proses ditutup supaya slotnya dipakai aset lain. */
  evict(): void {
    this.#closeSession();
  }

  #emit(event: AgentEvent): void {
    this.#options.emit(event);
  }

  /**
   * Mengirim pesan ke Claude. Event `user` langsung dicatat (thread menampilkannya walau masih antre); pesan dikirim
   * setelah giliran sebelumnya selesai dan proses Claude mendapat slot pool.
   */
  /**
   * `display`: teks yang tampil di thread (kata-kata pemilik), bila berbeda dari yang dikirim ke Claude (catatan
   * lampiran, pembuka sesi). `attachments`: chip lampiran di thread.
   */
  send(
    text: string,
    options: {
      origin?: SystemMessageOrigin;
      display?: string;
      attachments?: readonly MessageAttachment[];
    } = {},
  ): void {
    if (this.#closed) throw new Error("runner sudah ditutup");
    const uuid = randomUUID();
    // Surrogate tunggal (mis. dari escape JSON) ditolak API Claude dan akan merusak transkrip sesi.
    this.#inbox.push({ uuid, text: text.toWellFormed() });
    this.#emit({
      type: "user",
      uuid,
      text: options.display ?? text,
      ...(options.origin === undefined ? {} : { origin: options.origin }),
      ...(options.attachments === undefined || options.attachments.length === 0
        ? {}
        : { attachments: options.attachments }),
    });
    this.#pump();
  }

  #pump(): void {
    if (this.#turn !== undefined || this.#closed || this.#starting || this.#inbox.length === 0) return;
    const session = this.#session;
    if (session === undefined) {
      void this.#startSession().catch((error: unknown) => this.#failStart(error));
      return;
    }
    const next = this.#inbox.shift();
    if (next === undefined) return;
    this.#cancelIdle();
    this.#lease?.touch();
    this.#turn = { uuid: next.uuid, stopped: false };
    this.#usageLimit = undefined;
    this.#status = "running";
    this.#options.onOwnerMessage?.();
    session.send({
      type: "user",
      message: { role: "user", content: next.text },
      parent_tool_use_id: null,
      uuid: next.uuid,
    });
  }

  /** Meminta slot pool (bisa antre), lalu memulai proses Claude dan mengirim pesan berikutnya. */
  async #startSession(): Promise<void> {
    this.#starting = true;
    const request = new AbortController();
    this.#slotRequest = request;
    try {
      const pool = this.#options.pool;
      if (pool !== undefined) {
        if (pool.wouldWait()) this.#emit({ type: "notice", text: QUEUED_NOTICE });
        this.#lease = await pool.acquire(this, request.signal);
      }
    } catch (error) {
      if (error instanceof PoolAbortedError) return;
      throw error;
    } finally {
      this.#starting = false;
      this.#slotRequest = undefined;
    }
    if (this.#closed || this.#inbox.length === 0) {
      this.#releaseLease();
      return;
    }
    this.#session = this.#openSession();
    this.#pump();
  }

  /** Proses tidak bisa dimulai: pesan yang antre dibuang dan giliran dinyatakan gagal (bisa dicoba lagi). */
  #failStart(error: unknown): void {
    this.#releaseLease();
    this.#options.onError?.(error, "mulai proses Claude");
    const dropped = this.#inbox.splice(0).length;
    this.#emit({ type: "error", code: "SESSION_FAILED", message: SESSION_START_FAILED_MESSAGE });
    if (dropped > 1) this.#emit({ type: "notice", text: `${dropped - 1} pesan lain yang antre dibatalkan.` });
  }

  #openSession(): AgentSession {
    const session = this.#options.port.start(
      this.#options.sessionOptions({
        ...(this.#sessionId === undefined ? {} : { resume: this.#sessionId }),
        canUseTool: this.#canUseTool,
      }),
    );
    void this.#consume(session).catch((error: unknown) => {
      this.#options.onError?.(error, "baca aliran sesi Claude");
      this.#emit({ type: "error", code: "SESSION_FAILED", message: SESSION_CRASHED_MESSAGE });
    });
    return session;
  }

  async #consume(session: AgentSession): Promise<void> {
    let failed = false;
    try {
      for await (const message of session.messages) {
        // Sesi yang sudah diganti atau ditutup masih bisa mengeluarkan pesan ter-buffer: abaikan.
        if (this.#session !== session) continue;
        const meta = resultMeta(message);
        for (const event of toAgentEvents(message)) {
          if (event.type === "init") this.#sessionId = event.sessionId;
          if (event.type === "error" && event.code === "USAGE_LIMIT" && this.#turn !== undefined) {
            this.#noteUsageLimit(event, message.type === "assistant");
            continue;
          }
          if (event.type === "result") {
            this.#onResult(event, meta?.userMessageUuids ?? []);
            continue;
          }
          this.#emit(event);
        }
      }
    } catch (error) {
      failed = true;
      this.#options.onError?.(error, "sesi Claude berhenti");
    }
    if (this.#session !== session) return;
    this.#session = undefined;
    this.#cancelIdle();
    this.#releaseLease();
    this.#onStreamEnd(failed);
  }

  #noteUsageLimit(event: Extract<AgentEvent, { type: "error" }>, fromText: boolean): void {
    const previous = this.#usageLimit;
    const resetsAt = event.resetsAt ?? previous?.resetsAt;
    const text = fromText ? event.message : previous?.text;
    this.#usageLimit = {
      fromText: fromText || previous?.fromText === true,
      ...(resetsAt === undefined ? {} : { resetsAt }),
      ...(text === undefined ? {} : { text }),
    };
  }

  /** Giliran gagal karena batas pemakaian: pesan yang antre juga akan gagal, jadi dibuang. */
  #failUsageLimit(limit: UsageLimit): void {
    this.#emit({
      type: "error",
      code: "USAGE_LIMIT",
      // Teks asli Claude Code (bahasa Inggris) memuat waktu reset bila `resetsAt` tidak ada.
      message:
        limit.text === undefined
          ? USAGE_LIMIT_MESSAGE
          : `${USAGE_LIMIT_MESSAGE} Claude Code: "${limit.text}"`,
      ...(limit.resetsAt === undefined ? {} : { resetsAt: limit.resetsAt }),
    });
    const dropped = this.#inbox.splice(0).length;
    if (dropped > 0) {
      this.#emit({ type: "notice", text: `${dropped} pesan yang antre dibatalkan karena batas pemakaian.` });
    }
  }

  #onResult(event: Extract<AgentEvent, { type: "result" }>, uuids: readonly string[]): void {
    const turn = this.#turn;
    const mine = turn !== undefined && uuids.includes(turn.uuid);
    if (!mine) return;
    const limit = this.#usageLimit;
    if (limit !== undefined && !turn.stopped && (limit.fromText || event.isError))
      this.#failUsageLimit(limit);
    this.#emit({ ...event, interrupted: turn.stopped });
    this.#finishTurn();
  }

  /** Aliran sesi berakhir sendiri (proses mati, error). Sesi berikutnya di-resume dari session id terakhir. */
  #onStreamEnd(failed: boolean): void {
    this.#cancelQuestions();
    const turn = this.#turn;
    if (turn === undefined) {
      if (failed) this.#emit({ type: "notice", text: SESSION_CRASHED_MESSAGE });
      return;
    }
    if (!turn.stopped) {
      const limit = this.#usageLimit;
      if (limit !== undefined) this.#failUsageLimit(limit);
      else {
        this.#emit({
          type: "error",
          code: "SESSION_FAILED",
          message: failed ? SESSION_CRASHED_MESSAGE : "Sesi Claude berakhir sebelum giliran selesai.",
        });
      }
    }
    this.#emit({
      type: "result",
      subtype: turn.stopped ? "interrupted" : "error_during_execution",
      isError: !turn.stopped,
      interrupted: turn.stopped,
      durationMs: 0,
      numTurns: 0,
    });
    this.#finishTurn();
  }

  #finishTurn(): void {
    this.#stopGrace?.cancel();
    this.#stopGrace = undefined;
    this.#turn = undefined;
    this.#usageLimit = undefined;
    this.#status = "idle";
    this.#pump();
    if (this.#turn === undefined && !this.#starting) this.#becameIdle();
  }

  /** Tidak ada giliran lagi: beri slot ke yang antre, atau tutup proses setelah idle cukup lama. */
  #becameIdle(): void {
    if (this.#session === undefined || this.#closed) return;
    this.#options.pool?.notifyIdle(this);
    if (this.#session === undefined) return;
    this.#lease?.touch();
    this.#cancelIdle();
    const schedule = this.#options.schedule ?? defaultSchedule;
    this.#idleTimer = schedule(() => {
      this.#idleTimer = undefined;
      if (this.evictable) this.#closeSession();
    }, this.#options.idleShutdownMs ?? AGENT_IDLE_SHUTDOWN_MS);
  }

  #cancelIdle(): void {
    this.#idleTimer?.cancel();
    this.#idleTimer = undefined;
  }

  #releaseLease(): void {
    const lease = this.#lease;
    this.#lease = undefined;
    lease?.release();
  }

  /**
   * Stop: pesan antre dibuang, build dibatalkan, Claude di-interrupt, baru kartu pertanyaan ditutup
   * (kalau kartu duluan, Claude sempat melanjutkan giliran dengan penolakan).
   */
  async interrupt(): Promise<void> {
    this.#slotRequest?.abort();
    const dropped = this.#inbox.splice(0).length;
    if (dropped > 0)
      this.#emit({ type: "notice", text: `${dropped} pesan yang belum dikerjakan dibatalkan oleh Stop.` });
    const turn = this.#turn;
    const session = this.#session;
    if (turn === undefined || session === undefined) return;
    turn.stopped = true;
    this.#options.onStop?.();
    const receipt = await session.interrupt();
    this.#cancelQuestions();
    if (this.#turn !== turn) return;
    if (receipt?.cancelled?.includes(turn.uuid)) {
      // Pesan kita masih antre di CLI dan dibatalkan: result-nya tidak akan datang.
      this.#emit({
        type: "result",
        subtype: "interrupted",
        isError: false,
        interrupted: true,
        durationMs: 0,
        numTurns: 0,
      });
      this.#finishTurn();
      return;
    }
    const schedule = this.#options.schedule ?? defaultSchedule;
    this.#stopGrace = schedule(() => {
      if (this.#turn !== turn || this.#session !== session) return;
      this.#emit({
        type: "notice",
        text: "Sesi tidak merespons Stop; proses Claude ditutup (bisa dilanjutkan).",
      });
      this.#closeSession();
      this.#emit({
        type: "result",
        subtype: "interrupted",
        isError: false,
        interrupted: true,
        durationMs: 0,
        numTurns: 0,
      });
      this.#finishTurn();
    }, this.#options.stopGraceMs ?? STOP_GRACE_MS);
  }

  #closeSession(): void {
    const session = this.#session;
    // Dikosongkan sebelum close(): pesan yang masih ter-buffer dianggap basi.
    this.#session = undefined;
    this.#cancelIdle();
    session?.close();
    this.#releaseLease();
  }

  /** Menutup sesi (mis. server berhenti, aset dihapus). Session id disimpan, jadi sesi bisa di-resume. */
  close(): void {
    this.#closed = true;
    this.#slotRequest?.abort();
    this.#inbox.splice(0);
    this.#options.onStop?.();
    this.#cancelQuestions();
    this.#stopGrace?.cancel();
    this.#closeSession();
    this.#turn = undefined;
    this.#status = "idle";
  }

  /** Jawaban pemilik untuk kartu pertanyaan: pilihan per pertanyaan (pilih satu/banyak) dan/atau "Lainnya". */
  answer(questionId: string, submission: AnswerSubmission): AnswerResult {
    const pending = this.#questions.get(questionId);
    if (pending === undefined) {
      return { ok: false, code: "QUESTION_NOT_FOUND", message: "Pertanyaan ini sudah tidak terbuka." };
    }
    const formatted = formatAnswers(pending.questions, submission);
    if (!formatted.ok) return formatted;
    this.#questions.delete(questionId);
    // Teks "Lainnya" dari pemilik ikut dikirim ke Claude: surrogate tunggal diganti seperti di `send()`.
    pending.resolve(
      Object.fromEntries(
        Object.entries(formatted.answers).map(([question, answer]) => [question, answer.toWellFormed()]),
      ),
    );
    return { ok: true };
  }

  #cancelQuestions(): void {
    for (const [id, pending] of [...this.#questions]) {
      this.#questions.delete(id);
      pending.resolve(null);
    }
  }

  #canUseTool: CanUseTool = async (toolName, input, context): Promise<PermissionResult> => {
    if (toolName === "AskUserQuestion") return this.#ask(input, context.signal);
    const verdict = await this.#options.checkTool(toolName, input);
    return verdict.allow
      ? { behavior: "allow", updatedInput: input }
      : { behavior: "deny", message: `Ditolak pagar: ${verdict.reason}` };
  };

  async #ask(input: Record<string, unknown>, signal: AbortSignal): Promise<PermissionResult> {
    const parsed = AskInput.safeParse(input);
    if (!parsed.success) return { behavior: "deny", message: "Format pertanyaan tidak valid." };
    const questions = parsed.data.questions;
    const questionId = randomUUID();
    const answers = await new Promise<Readonly<Record<string, string>> | null>((resolve) => {
      this.#questions.set(questionId, { questions, resolve });
      this.#status = "waiting_user";
      this.#emit({ type: "question", questionId, questions });
      // Claude Code bisa mencabut permintaan sendiri (mis. saat interrupt).
      const onAbort = () => {
        if (this.#questions.delete(questionId)) resolve(null);
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
    this.#emit({
      type: "question_resolved",
      questionId,
      answers: answers ?? {},
      cancelled: answers === null,
    });
    if (this.#turn !== undefined) this.#status = "running";
    if (answers === null) return { behavior: "deny", message: "Pertanyaan dibatalkan." };
    return { behavior: "allow", updatedInput: { questions, answers } };
  }
}
