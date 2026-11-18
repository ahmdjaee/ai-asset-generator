/**
 * Event thread aset: event sesi Claude (`AgentEvent`) + event aset (status, aksi pemilik).
 * - Event disimpan di tabel `events` dengan `seq` berurutan per aset, kecuali event live (`delta`, `build_progress`).
 * - Skema zod dipakai saat membaca dari database (dan nanti di batas realtime). Tipe `z.ZodType<…>` memaksa skema
 *   tetap sesuai dengan tipe TypeScript-nya.
 */
import { z } from "zod";
import { type AgentEvent, ATTACHMENT_KINDS, SYSTEM_MESSAGE_ORIGINS } from "./agent-events.ts";
import { ASSET_STATUSES, type AssetStatus, LastError, RUN_STATES, type RunState } from "./asset.ts";
import { Brief } from "./brief.ts";

/** Aksi pemilik yang dicatat di thread. Pesan pemilik sendiri tercatat sebagai event `user`. */
export const OWNER_ACTIONS = ["approve", "finish", "change_shape", "stop", "retry", "resume"] as const;
export type OwnerAction = (typeof OWNER_ACTIONS)[number];

export type AssetStateEvent = Readonly<{
  type: "state";
  status: AssetStatus;
  runState: RunState;
  lastError: LastError | null;
  approvedBaseVersion: number | null;
  currentVersion: number | null;
  buildsLeft: number;
}>;

export type AssetEvent =
  | AgentEvent
  | AssetStateEvent
  | Readonly<{ type: "action"; action: OwnerAction; version?: number }>;

/** Event yang hanya disiarkan live (tidak disimpan, tidak di-replay). */
export const LIVE_ONLY_EVENTS: ReadonlySet<AssetEvent["type"]> = new Set(["delta", "build_progress"]);

export function isLiveOnly(event: AssetEvent): boolean {
  return LIVE_ONLY_EVENTS.has(event.type);
}

const AskQuestionSchema = z.object({
  question: z.string(),
  header: z.string(),
  options: z.array(z.object({ label: z.string(), description: z.string() })),
  multiSelect: z.boolean(),
});

const Int = z.number().int();

export const AssetEventSchema: z.ZodType<AssetEvent> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("init"), sessionId: z.string(), model: z.string() }),
  z.object({
    type: z.literal("user"),
    uuid: z.string(),
    text: z.string(),
    origin: z.enum(SYSTEM_MESSAGE_ORIGINS).optional(),
    attachments: z
      .array(z.object({ id: z.string(), kind: z.enum(ATTACHMENT_KINDS), name: z.string() }))
      .optional(),
  }),
  z.object({ type: z.literal("delta"), kind: z.enum(["text", "thinking"]), text: z.string() }),
  z.object({ type: z.literal("assistant"), text: z.string() }),
  z.object({ type: z.literal("thinking"), text: z.string() }),
  z.object({ type: z.literal("tool"), toolUseId: z.string(), name: z.string(), input: z.json() }),
  z.object({
    type: z.literal("tool_result"),
    toolUseId: z.string(),
    isError: z.boolean(),
    preview: z.string(),
    images: Int.nonnegative(),
  }),
  z.object({ type: z.literal("question"), questionId: z.string(), questions: z.array(AskQuestionSchema) }),
  z.object({
    type: z.literal("question_resolved"),
    questionId: z.string(),
    answers: z.record(z.string(), z.string()),
    cancelled: z.boolean(),
  }),
  z.object({ type: z.literal("brief"), brief: Brief }),
  z.object({
    type: z.literal("build_started"),
    jobId: z.string(),
    stage: z.enum(["base", "textured"]),
    buildNumber: Int.positive(),
  }),
  z.object({ type: z.literal("build_progress"), jobId: z.string(), step: z.string(), pct: z.number() }),
  z.object({
    type: z.literal("build_finished"),
    jobId: z.string(),
    ok: z.boolean(),
    version: Int.positive().optional(),
    code: z.string().optional(),
  }),
  z.object({
    type: z.literal("submitted"),
    version: Int.positive(),
    summary: z.string(),
    stage: z.enum(["base", "textured"]),
  }),
  z.object({ type: z.literal("notice"), text: z.string() }),
  z.object({
    type: z.literal("error"),
    code: z.enum(["USAGE_LIMIT", "AUTH_REQUIRED", "SESSION_FAILED", "TOOL_DENIED"]),
    message: z.string(),
    resetsAt: z.number().optional(),
  }),
  z.object({
    type: z.literal("result"),
    subtype: z.string(),
    isError: z.boolean(),
    interrupted: z.boolean(),
    durationMs: z.number(),
    numTurns: Int.nonnegative(),
    costUsd: z.number().optional(),
  }),
  z.object({
    type: z.literal("state"),
    status: z.enum(ASSET_STATUSES),
    runState: z.enum(RUN_STATES),
    lastError: LastError.nullable(),
    approvedBaseVersion: Int.positive().nullable(),
    currentVersion: Int.positive().nullable(),
    buildsLeft: Int.nonnegative(),
  }),
  z.object({ type: z.literal("action"), action: z.enum(OWNER_ACTIONS), version: Int.positive().optional() }),
]);

/** Event yang sudah dicatat. `seq` null untuk event live. */
export type StoredEvent = Readonly<{ assetId: string; seq: number | null; ts: number; event: AssetEvent }>;

export const StoredEventSchema: z.ZodType<StoredEvent> = z.object({
  assetId: z.string(),
  seq: Int.positive().nullable(),
  ts: Int,
  event: AssetEventSchema,
});
