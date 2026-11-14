/** Event sesi Claude untuk UI dan transcript (hasil `server/agent/events.ts` + event tool `forge`). */
import type { Brief } from "./brief.ts";

export type AskOption = Readonly<{ label: string; description: string }>;
export type AskQuestion = Readonly<{
  question: string;
  header: string;
  options: readonly AskOption[];
  multiSelect: boolean;
}>;

export type AgentErrorCode = "USAGE_LIMIT" | "SESSION_FAILED" | "TOOL_DENIED";

/** Jenis lampiran pemilik: gambar referensi atau model 3D. */
export const ATTACHMENT_KINDS = ["image", "model"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/** Lampiran yang menyertai pesan pemilik (chip di thread). */
export type MessageAttachment = Readonly<{ id: string; kind: AttachmentKind; name: string }>;

/** Lampiran untuk Claude: nama file di `refs/`, dan varian decal untuk gambar. */
export type AttachmentRef = MessageAttachment & Readonly<{ file: string; decal: string | null }>;

/** Asal pesan ke Claude yang disusun app dari aksi pemilik (bukan diketik pemilik). */
export const SYSTEM_MESSAGE_ORIGINS = ["approved", "change_shape", "resume", "retry"] as const;
export type SystemMessageOrigin = (typeof SYSTEM_MESSAGE_ORIGINS)[number];

export type AgentEvent =
  | Readonly<{ type: "init"; sessionId: string; model: string }>
  /**
   * Pesan ke Claude. `origin` ada bila pesan disusun app dari aksi pemilik; tanpa `origin` = diketik pemilik (`text`
   * = kata-kata pemilik saja, tanpa catatan lampiran atau pembuka sesi yang ikut terkirim ke Claude).
   */
  | Readonly<{
      type: "user";
      uuid: string;
      text: string;
      origin?: SystemMessageOrigin;
      attachments?: readonly MessageAttachment[];
    }>
  | Readonly<{ type: "delta"; kind: "text" | "thinking"; text: string }>
  | Readonly<{ type: "assistant"; text: string }>
  /** Ringkasan berpikir (thinking `display: "summarized"`). */
  | Readonly<{ type: "thinking"; text: string }>
  | Readonly<{ type: "tool"; toolUseId: string; name: string; input: unknown }>
  | Readonly<{ type: "tool_result"; toolUseId: string; isError: boolean; preview: string; images: number }>
  | Readonly<{ type: "question"; questionId: string; questions: readonly AskQuestion[] }>
  | Readonly<{
      type: "question_resolved";
      questionId: string;
      answers: Readonly<Record<string, string>>;
      cancelled: boolean;
    }>
  | Readonly<{ type: "brief"; brief: Brief }>
  | Readonly<{ type: "build_started"; jobId: string; stage: "base" | "textured"; buildNumber: number }>
  | Readonly<{ type: "build_progress"; jobId: string; step: string; pct: number }>
  | Readonly<{ type: "build_finished"; jobId: string; ok: boolean; version?: number; code?: string }>
  | Readonly<{ type: "submitted"; version: number; summary: string; stage: "base" | "textured" }>
  | Readonly<{ type: "notice"; text: string }>
  | Readonly<{ type: "error"; code: AgentErrorCode; message: string; resetsAt?: number }>
  | Readonly<{
      type: "result";
      subtype: string;
      isError: boolean;
      interrupted: boolean;
      durationMs: number;
      numTurns: number;
      costUsd?: number;
    }>;
