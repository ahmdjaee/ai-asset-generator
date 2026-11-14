/**
 * Model tampilan thread Studio: event tersimpan + stream → daftar item yang dirender. Fungsi murni, dites tanpa DOM.
 *
 * - Pesan pemilik (`user` tanpa `origin`) dan aksi pemilik (`action`) memisahkan giliran. Pesan yang disusun app
 *   (`user` dengan `origin`) tidak ditampilkan, karena aksinya sudah tercatat sebagai `action`.
 * - Event Claude dalam satu giliran dikumpulkan dalam grup berkepala "Claude" (FigCraft "Pesan Claude" #1044).
 *   Setelah pertanyaan dijawab, lanjutan giliran itu menjadi grup baru tanpa kepala (#1083).
 * - Build (`build_started` … `build_finished`) menjadi satu kartu progres. Mulai "Menulis skrip" diambil dari tool
 *   Write/Edit pertama ke skrip build sejak build sebelumnya.
 */
import { z } from "zod";
import type { AgentErrorCode, AskQuestion, MessageAttachment } from "../../../shared/agent-events.ts";
import type { OwnerAction } from "../../../shared/asset-events.ts";
import type { Brief } from "../../../shared/brief.ts";
import type { ThreadEvent } from "./thread-store.ts";

export type BuildStatus = "running" | "done" | "failed" | "stopped";

export type BuildBlock = Readonly<{
  kind: "build";
  key: string;
  jobId: string;
  stage: "base" | "textured";
  status: BuildStatus;
  version: number | null;
  /** Kode gagal dari harness (`SCRIPT_ERROR`, `TIMEOUT`, …), bila gagal. */
  code: string | null;
  startedAt: number;
  endedAt: number | null;
  /** Waktu tool Write/Edit pertama ke skrip build ini, bila ada. */
  scriptStartedAt: number | null;
}>;

export type QuestionResolution = Readonly<{ answers: Readonly<Record<string, string>>; cancelled: boolean }>;

export type ClaudeBlock =
  | Readonly<{ kind: "thinking"; key: string; text: string; durationMs: number | null; live: boolean }>
  | Readonly<{ kind: "text"; key: string; text: string; live: boolean }>
  | Readonly<{
      kind: "question";
      key: string;
      questionId: string;
      questions: readonly AskQuestion[];
      resolution: QuestionResolution | null;
    }>
  | Readonly<{ kind: "brief"; key: string; brief: Brief }>
  | BuildBlock
  | Readonly<{ kind: "notice"; key: string; text: string }>
  | Readonly<{
      kind: "error";
      key: string;
      code: AgentErrorCode | "TURN_FAILED";
      message: string;
      resetsAt: number | null;
    }>
  | Readonly<{ kind: "stopped"; key: string }>;

export type ThreadItem =
  | Readonly<{ kind: "user"; key: string; text: string; attachments: readonly MessageAttachment[] }>
  | Readonly<{ kind: "action"; key: string; action: OwnerAction; version: number | null }>
  | Readonly<{ kind: "claude"; key: string; header: boolean; blocks: readonly ClaudeBlock[] }>;

export type ThreadInput = Readonly<{
  events: readonly ThreadEvent[];
  streaming: Readonly<{ text: string; thinking: string }>;
  /** Proses Claude sedang berjalan (`runState: running`). Tanpa ini build yang belum selesai dianggap berhenti. */
  running: boolean;
}>;

/** Skrip yang dijalankan build (ditulis Claude di `work/`). */
const BUILD_SCRIPTS = ["base.py", "material.py"];
const SCRIPT_TOOLS = new Set(["Write", "Edit"]);
const ToolPath = z.object({ file_path: z.string() });

function isScriptWrite(name: string, input: unknown): boolean {
  if (!SCRIPT_TOOLS.has(name)) return false;
  const parsed = ToolPath.safeParse(input);
  return parsed.success && BUILD_SCRIPTS.some((script) => parsed.data.file_path.endsWith(`/${script}`));
}

type MutableGroup = { kind: "claude"; key: string; header: boolean; blocks: ClaudeBlock[] };
type BlockRef = Readonly<{ group: MutableGroup; index: number }>;

/** Penyusun item: menyimpan grup yang sedang terbuka dan posisi kartu yang diperbarui event sesudahnya. */
class ItemsBuilder {
  readonly items: ThreadItem[] = [];
  #group: MutableGroup | null = null;
  /** Giliran baru dimulai (atau awal jendela): grup Claude berikutnya berkepala. */
  #newTurn = true;
  /** Kartu build (`build:<jobId>`) dan pertanyaan (`question:<id>`). */
  readonly #refs = new Map<string, BlockRef>();

  /** Grup Claude berikutnya dimulai baru; `turn` = giliran baru (grup berkepala). */
  close(turn: boolean): void {
    this.#group = null;
    if (turn) this.#newTurn = true;
  }

  item(item: ThreadItem): void {
    this.items.push(item);
  }

  push(block: ClaudeBlock, ref?: string): void {
    if (this.#group === null) {
      this.#group = { kind: "claude", key: `g-${block.key}`, header: this.#newTurn, blocks: [] };
      this.items.push(this.#group);
      this.#newTurn = false;
    }
    this.#group.blocks.push(block);
    if (ref !== undefined) this.#refs.set(ref, { group: this.#group, index: this.#group.blocks.length - 1 });
  }

  last(): ClaudeBlock | undefined {
    return this.#group?.blocks.at(-1);
  }

  update(ref: string, change: (block: ClaudeBlock) => ClaudeBlock): void {
    const target = this.#refs.get(ref);
    const block = target?.group.blocks[target.index];
    if (target === undefined || block === undefined) return;
    target.group.blocks[target.index] = change(block);
  }

  /** Build yang belum selesai saat giliran berakhir (atau proses tidak berjalan) dianggap berhenti. */
  stopRunningBuilds(at: number): void {
    for (const ref of this.#refs.keys()) {
      if (!ref.startsWith("build:")) continue;
      this.update(ref, (block) =>
        block.kind === "build" && block.status === "running"
          ? { ...block, status: "stopped", endedAt: at }
          : block,
      );
    }
  }
}

export function threadItems({ events, streaming, running }: ThreadInput): ThreadItem[] {
  const out = new ItemsBuilder();
  let previousTs: number | null = null;
  let scriptStartedAt: number | null = null;

  for (const stored of events) {
    const { event, ts, seq } = stored;
    const key = `e${seq}`;
    switch (event.type) {
      case "user":
        out.close(true);
        scriptStartedAt = null;
        if (event.origin === undefined) {
          out.item({ kind: "user", key, text: event.text, attachments: event.attachments ?? [] });
        }
        break;
      case "action":
        out.close(true);
        out.item({ kind: "action", key, action: event.action, version: event.version ?? null });
        break;
      case "thinking":
        out.push({
          kind: "thinking",
          key,
          text: event.text,
          durationMs: previousTs === null ? null : ts - previousTs,
          live: false,
        });
        break;
      case "assistant":
        if (event.text.trim() !== "") out.push({ kind: "text", key, text: event.text, live: false });
        break;
      case "question":
        out.push(
          {
            kind: "question",
            key,
            questionId: event.questionId,
            questions: event.questions,
            resolution: null,
          },
          `question:${event.questionId}`,
        );
        break;
      case "question_resolved":
        out.update(`question:${event.questionId}`, (block) =>
          block.kind === "question"
            ? { ...block, resolution: { answers: event.answers, cancelled: event.cancelled } }
            : block,
        );
        // Lanjutan giliran setelah jawaban menjadi grup baru tanpa kepala.
        out.close(false);
        break;
      case "brief":
        out.push({ kind: "brief", key, brief: event.brief });
        break;
      case "tool":
        if (scriptStartedAt === null && isScriptWrite(event.name, event.input)) scriptStartedAt = ts;
        break;
      case "build_started":
        out.push(
          {
            kind: "build",
            key,
            jobId: event.jobId,
            stage: event.stage,
            status: "running",
            version: null,
            code: null,
            startedAt: ts,
            endedAt: null,
            scriptStartedAt,
          },
          `build:${event.jobId}`,
        );
        scriptStartedAt = null;
        break;
      case "build_finished":
        out.update(`build:${event.jobId}`, (block) =>
          block.kind === "build"
            ? {
                ...block,
                status: event.ok ? "done" : event.code === "CANCELLED" ? "stopped" : "failed",
                version: event.version ?? null,
                code: event.ok ? null : (event.code ?? null),
                endedAt: ts,
              }
            : block,
        );
        break;
      case "notice":
        out.push({ kind: "notice", key, text: event.text });
        break;
      case "error":
        out.push({
          kind: "error",
          key,
          code: event.code,
          message: event.message,
          resetsAt: event.resetsAt ?? null,
        });
        break;
      case "result":
        out.stopRunningBuilds(ts);
        if (event.interrupted) out.push({ kind: "stopped", key });
        else if (event.isError && out.last()?.kind !== "error") {
          out.push({ kind: "error", key, code: "TURN_FAILED", message: "", resetsAt: null });
        }
        break;
      default:
        break;
    }
    previousTs = ts;
  }

  if (!running) out.stopRunningBuilds(previousTs ?? 0);
  if (streaming.thinking !== "") {
    out.push({
      kind: "thinking",
      key: "live-thinking",
      text: streaming.thinking,
      durationMs: null,
      live: true,
    });
  }
  if (streaming.text !== "") out.push({ kind: "text", key: "live-text", text: streaming.text, live: true });
  return out.items;
}
