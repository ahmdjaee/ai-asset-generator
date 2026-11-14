/**
 * Status aset & transisi (PLAN Lampiran C). Fungsi murni: `transition(state, action) → { state, effects }`.
 *
 * Satu-satunya tempat aturan tahap (AGENTS.md §3). Pemanggilnya:
 * - tool `forge` (aksi Claude: brief, build, submit);
 * - service aset (aksi pemilik: pesan, setujui, revisi, selesai, ubah bentuk, stop, coba lagi, lanjutkan);
 * - runner (giliran dimulai/selesai, pertanyaan, gagal) dan pemulihan saat start.
 *
 * Aturan pokok:
 * - Hanya aksi pemilik yang bisa keluar dari `*_REVIEW`.
 * - Stop tidak mengubah tahap: `runState` menjadi `idle`, efeknya interrupt.
 * - Jatah build dihitung per pesan pemilik dan direset saat pesan benar-benar dikirim ke Claude (`turn_started`).
 * - Efek hanya niat (kirim pesan ke Claude, interrupt); service yang menjalankannya.
 */
import type { AttachmentRef } from "../../shared/agent-events.ts";
import type { AssetStatus, LastError, RunState } from "../../shared/asset.ts";
import type { Brief } from "../../shared/brief.ts";
import { BUILD_CAPS } from "../../shared/limits.ts";

export type AssetState = Readonly<{
  status: AssetStatus;
  runState: RunState;
  lastError: LastError | null;
  brief: Brief | null;
  /** Versi bentuk dasar yang disetujui pemilik; dasar tahap tekstur. */
  approvedBaseVersion: number | null;
  /** Versi terakhir yang dibuat, atau versi yang sedang direview. */
  currentVersion: number | null;
  /** Build sejak pesan pemilik terakhir dikirim ke Claude. */
  buildsThisMessage: number;
}>;

export const INITIAL_STATE: AssetState = {
  status: "BRIEFING",
  runState: "idle",
  lastError: null,
  brief: null,
  approvedBaseVersion: null,
  currentVersion: null,
  buildsThisMessage: 0,
};

export type BuildStage = "base" | "textured";

/** Pesan ke Claude yang lahir dari aksi. Teksnya disusun di `server/agent/prompts.ts`. */
export type Outbound =
  | Readonly<{ kind: "owner"; text: string; attachments?: readonly AttachmentRef[] }>
  | Readonly<{ kind: "approved"; version: number; note?: string }>
  | Readonly<{ kind: "change_shape"; text: string }>
  | Readonly<{ kind: "resume" }>
  | Readonly<{ kind: "retry" }>;

/** Permintaan terakhir ke Claude: teks yang dikirim + lampirannya (catatan lampiran disusun ulang saat dikutip). */
export type LastRequest = Readonly<{ text: string; attachments?: readonly AttachmentRef[] }>;

/** Konteks penyusunan pesan untuk Claude (lanjutkan / coba lagi). */
export type OutboundContext = Readonly<{
  /** Permintaan terakhir ke Claude (pesan pemilik, persetujuan, atau ubah bentuk); bisa belum pernah terkirim. */
  lastRequest?: LastRequest;
  /** Error giliran yang gagal (untuk coba lagi). */
  lastError?: LastError | null;
}>;

export type Effect =
  | Readonly<{ type: "deliver"; message: Outbound }>
  /** Hentikan giliran Claude, batalkan build, tutup kartu pertanyaan. */
  | Readonly<{ type: "interrupt" }>;

export type AssetAction =
  // Claude, lewat tool `forge`
  | Readonly<{ type: "record_brief"; brief: Brief }>
  | Readonly<{ type: "build_start"; stage: BuildStage }>
  | Readonly<{ type: "build_done"; version: number }>
  | Readonly<{ type: "submit"; version: number; stage: BuildStage }>
  // Pemilik
  | Readonly<{ type: "message"; text: string; attachments?: readonly AttachmentRef[] }>
  | Readonly<{ type: "revise"; text: string; attachments?: readonly AttachmentRef[] }>
  | Readonly<{ type: "approve"; note?: string }>
  | Readonly<{ type: "finish" }>
  | Readonly<{ type: "change_shape"; text: string }>
  | Readonly<{ type: "stop" }>
  | Readonly<{ type: "retry" }>
  | Readonly<{ type: "resume" }>
  // Runner
  | Readonly<{ type: "turn_started" }>
  | Readonly<{ type: "question_opened" }>
  | Readonly<{ type: "question_closed" }>
  | Readonly<
      | { type: "turn_ended"; outcome: "success" | "interrupted" }
      | { type: "turn_ended"; outcome: "error"; error: LastError }
    >
  | Readonly<{ type: "failed"; error: LastError }>
  // Server start
  | Readonly<{ type: "interrupted" }>;

export type RejectCode =
  | "IN_REVIEW"
  | "BASE_LOCKED"
  | "BRIEF_REQUIRED"
  | "BASE_NOT_APPROVED"
  | "BUILD_CAP_REACHED"
  | "WRONG_STAGE"
  | "ASSET_DONE"
  | "NOT_IN_REVIEW"
  | "NO_VERSION"
  | "QUESTION_OPEN"
  | "NOT_FAILED"
  | "NOT_INTERRUPTED"
  | "SHAPE_CHANGE_NOT_ALLOWED";

export type TransitionResult =
  | Readonly<{ ok: true; state: AssetState; effects: readonly Effect[] }>
  | Readonly<{ ok: false; code: RejectCode; message: string }>;

/**
 * Akses status satu aset. Diimplementasikan service dengan repositori (`AssetStore`) dan dipakai tool `forge`:
 * `apply` memuat, menjalankan `transition()`, dan menyimpan dalam satu transaksi.
 */
export interface AssetStateStore {
  read(): AssetState;
  apply(action: AssetAction): TransitionResult;
}

/** Pesan penolakan. Dibaca Claude (hasil tool) dan pemilik (respons HTTP), jadi bahasanya netral. */
const REJECT_MESSAGES: Readonly<Record<Exclude<RejectCode, "BUILD_CAP_REACHED">, string>> = {
  IN_REVIEW: "Versi sudah dikirim untuk review; build dan brief dikunci sampai pemilik membalas.",
  BASE_LOCKED:
    "Bentuk dasar sudah disetujui pemilik dan dikunci. Perubahan bentuk hanya lewat permintaan pemilik.",
  BRIEF_REQUIRED: "Catat brief dulu dengan record_brief.",
  BASE_NOT_APPROVED:
    "Tahap tekstur baru bisa dimulai setelah pemilik menyetujui bentuk dasar. Kirim bentuk dasar untuk review dulu.",
  WRONG_STAGE: "Versi itu bukan hasil tahap yang sedang dikerjakan.",
  ASSET_DONE: "Aset sudah selesai. Pemilik bisa melanjutkannya dengan pesan baru.",
  NOT_IN_REVIEW: "Aset tidak sedang menunggu review.",
  NO_VERSION: "Belum ada versi yang dikirim untuk review.",
  QUESTION_OPEN: "Claude sedang menunggu jawaban pertanyaan. Jawab dulu atau tekan Stop.",
  NOT_FAILED: "Tidak ada proses gagal yang bisa dicoba lagi.",
  NOT_INTERRUPTED: "Tidak ada proses terputus yang bisa dilanjutkan.",
  SHAPE_CHANGE_NOT_ALLOWED: "Ubah bentuk hanya tersedia saat review aset final atau setelah aset selesai.",
};

/** Batas build tahap: 8 bentuk dasar atau 4 aset final per pesan pemilik. */
export function buildCap(stage: BuildStage): number {
  return stage === "textured" ? BUILD_CAPS.textured : BUILD_CAPS.base;
}

/** Tahap build yang sedang berlaku untuk status ini (untuk sisa jatah build). */
export function stageOf(status: AssetStatus): BuildStage {
  return status === "TEXTURE_WORKING" || status === "TEXTURE_REVIEW" || status === "DONE"
    ? "textured"
    : "base";
}

export function buildsLeft(state: AssetState): number {
  return Math.max(0, buildCap(stageOf(state.status)) - state.buildsThisMessage);
}

function reject(code: Exclude<RejectCode, "BUILD_CAP_REACHED">): TransitionResult {
  return { ok: false, code, message: REJECT_MESSAGES[code] };
}

function next(
  state: AssetState,
  patch: Partial<AssetState>,
  effects: readonly Effect[] = [],
): TransitionResult {
  return { ok: true, state: { ...state, ...patch }, effects };
}

const isTextureStage = (status: AssetStatus) =>
  status === "TEXTURE_WORKING" || status === "TEXTURE_REVIEW" || status === "DONE";
const isReview = (status: AssetStatus) => status === "BASE_REVIEW" || status === "TEXTURE_REVIEW";

/** Pesan pemilik membuka giliran baru: review → kerja (revisi), DONE → tahap tekstur. */
function workingStatusAfterMessage(status: AssetStatus): AssetStatus {
  if (status === "BASE_REVIEW") return "BASE_WORKING";
  if (status === "TEXTURE_REVIEW" || status === "DONE") return "TEXTURE_WORKING";
  return status;
}

/** Patch untuk aksi pemilik yang mengirim pesan ke Claude. */
function ownerMessage(action: Readonly<{ text: string; attachments?: readonly AttachmentRef[] }>): Outbound {
  return action.attachments === undefined || action.attachments.length === 0
    ? { kind: "owner", text: action.text }
    : { kind: "owner", text: action.text, attachments: action.attachments };
}

function ownerTurn(state: AssetState, status: AssetStatus, message: Outbound): TransitionResult {
  if (state.runState === "waiting_user") return reject("QUESTION_OPEN");
  return next(state, { status, runState: "running", lastError: null }, [{ type: "deliver", message }]);
}

function recordBrief(state: AssetState, brief: Brief): TransitionResult {
  if (isTextureStage(state.status)) return reject("BASE_LOCKED");
  if (state.status === "BASE_REVIEW") return reject("IN_REVIEW");
  return next(state, { status: "BASE_WORKING", brief });
}

function buildStart(state: AssetState, stage: BuildStage): TransitionResult {
  const { status } = state;
  if (stage === "base") {
    if (isTextureStage(status)) return reject("BASE_LOCKED");
    if (status === "BRIEFING") return reject("BRIEF_REQUIRED");
    if (status === "BASE_REVIEW") return reject("IN_REVIEW");
  } else {
    if (!isTextureStage(status)) return reject("BASE_NOT_APPROVED");
    if (status === "TEXTURE_REVIEW") return reject("IN_REVIEW");
    if (status === "DONE") return reject("ASSET_DONE");
  }
  const cap = buildCap(stage);
  if (state.buildsThisMessage >= cap) {
    return {
      ok: false,
      code: "BUILD_CAP_REACHED",
      message: `Batas ${cap} build per pesan tercapai. Pilih versi terbaik dan submit, atau jelaskan kendalanya ke pemilik.`,
    };
  }
  return next(state, { buildsThisMessage: state.buildsThisMessage + 1 });
}

function submit(state: AssetState, version: number, stage: BuildStage): TransitionResult {
  const { status } = state;
  if (status === "BRIEFING") return reject("BRIEF_REQUIRED");
  if (isReview(status)) return reject("IN_REVIEW");
  if (status === "DONE") return reject("ASSET_DONE");
  if (stageOf(status) !== stage) return reject("WRONG_STAGE");
  return next(state, {
    status: status === "TEXTURE_WORKING" ? "TEXTURE_REVIEW" : "BASE_REVIEW",
    currentVersion: version,
  });
}

function approve(state: AssetState, note: string | undefined): TransitionResult {
  if (state.status !== "BASE_REVIEW") return reject("NOT_IN_REVIEW");
  const version = state.currentVersion;
  if (version === null) return reject("NO_VERSION");
  const result = ownerTurn(state, "TEXTURE_WORKING", {
    kind: "approved",
    version,
    ...(note === undefined ? {} : { note }),
  });
  if (!result.ok) return result;
  return next(result.state, { approvedBaseVersion: version, buildsThisMessage: 0 }, result.effects);
}

function changeShape(state: AssetState, text: string): TransitionResult {
  if (state.status !== "TEXTURE_REVIEW" && state.status !== "DONE") return reject("SHAPE_CHANGE_NOT_ALLOWED");
  const result = ownerTurn(state, "BASE_WORKING", { kind: "change_shape", text });
  if (!result.ok) return result;
  return next(result.state, { approvedBaseVersion: null, buildsThisMessage: 0 }, result.effects);
}

function stop(state: AssetState): TransitionResult {
  switch (state.runState) {
    case "running":
    case "waiting_user":
      return next(state, { runState: "idle" }, [{ type: "interrupt" }]);
    case "interrupted":
      return next(state, { runState: "idle" });
    default:
      return next(state, {});
  }
}

function turnEnded(
  state: AssetState,
  action: Extract<AssetAction, { type: "turn_ended" }>,
): TransitionResult {
  // Gagal dan terputus bertahan sampai pemilik bertindak (coba lagi / lanjutkan).
  if (state.runState === "failed" || state.runState === "interrupted") return next(state, {});
  if (action.outcome === "error") return next(state, { runState: "failed", lastError: action.error });
  return next(state, { runState: "idle" });
}

export function transition(state: AssetState, action: AssetAction): TransitionResult {
  switch (action.type) {
    case "record_brief":
      return recordBrief(state, action.brief);
    case "build_start":
      return buildStart(state, action.stage);
    case "build_done":
      return state.status === "BASE_WORKING" || state.status === "TEXTURE_WORKING"
        ? next(state, { currentVersion: action.version })
        : next(state, {});
    case "submit":
      return submit(state, action.version, action.stage);
    case "message":
      return ownerTurn(state, workingStatusAfterMessage(state.status), ownerMessage(action));
    case "revise":
      if (!isReview(state.status)) return reject("NOT_IN_REVIEW");
      return ownerTurn(state, workingStatusAfterMessage(state.status), ownerMessage(action));
    case "approve":
      return approve(state, action.note);
    case "finish":
      return state.status === "TEXTURE_REVIEW" ? next(state, { status: "DONE" }) : reject("NOT_IN_REVIEW");
    case "change_shape":
      return changeShape(state, action.text);
    case "stop":
      return stop(state);
    case "retry":
      if (state.runState !== "failed") return reject("NOT_FAILED");
      return next(state, { runState: "running", lastError: null }, [
        { type: "deliver", message: { kind: "retry" } },
      ]);
    case "resume":
      if (state.runState !== "interrupted") return reject("NOT_INTERRUPTED");
      return next(state, { runState: "running" }, [{ type: "deliver", message: { kind: "resume" } }]);
    case "turn_started":
      // Giliran baru: jatah build direset, error giliran sebelumnya tidak berlaku lagi.
      return next(state, { runState: "running", buildsThisMessage: 0, lastError: null });
    case "question_opened":
      return state.runState === "running" ? next(state, { runState: "waiting_user" }) : next(state, {});
    case "question_closed":
      return state.runState === "waiting_user" ? next(state, { runState: "running" }) : next(state, {});
    case "turn_ended":
      return turnEnded(state, action);
    case "failed":
      return next(state, { runState: "failed", lastError: action.error });
    case "interrupted":
      return state.runState === "running" || state.runState === "waiting_user"
        ? next(state, { runState: "interrupted" })
        : next(state, {});
  }
}
