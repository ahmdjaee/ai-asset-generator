import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { ATTACHMENT_KINDS } from "../../shared/agent-events.ts";
import { ASSET_STATUSES, RUN_STATES } from "../../shared/asset.ts";
import { TIER_IDS } from "../../shared/limits.ts";

/**
 * Skema database (PLAN Lampiran F). Mengubah file ini → `bun run db:generate`, lalu commit SQL migrasinya
 * (jangan `drizzle-kit push`).
 * - Waktu disimpan sebagai ms epoch (integer).
 * - Kolom JSON bertipe `unknown`: repositori memvalidasinya dengan zod saat membaca.
 * - Folder versi di disk tetap sumber kebenaran isi versi; tabel `versions` adalah indeks untuk Gudang.
 */

/** Pasangan kunci-nilai internal, mis. waktu database dibuat. */
export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const assets = sqliteTable(
  "assets",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    prompt: text("prompt").notNull(),
    tierId: text("tier_id", { enum: TIER_IDS }).notNull(),
    /** Budget tier saat aset dibuat (`TierBudget`); tidak ikut berubah bila Pengaturan diubah. */
    tierSnapshot: text("tier_snapshot", { mode: "json" }).$type<unknown>().notNull(),
    status: text("status", { enum: ASSET_STATUSES }).notNull(),
    runState: text("run_state", { enum: RUN_STATES }).notNull(),
    lastError: text("last_error", { mode: "json" }).$type<unknown>(),
    brief: text("brief", { mode: "json" }).$type<unknown>(),
    sessionId: text("session_id"),
    approvedBaseVersion: integer("approved_base_version"),
    currentVersion: integer("current_version"),
    /** Build sejak pesan pemilik terakhir dikirim ke Claude (batas build per pesan). */
    buildsThisMessage: integer("builds_this_message").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    index("assets_list_idx").on(table.deletedAt, table.updatedAt),
    index("assets_run_state_idx").on(table.runState),
  ],
);

export const versions = sqliteTable(
  "versions",
  {
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    n: integer("n").notNull(),
    stage: text("stage", { enum: ["base", "textured"] }).notNull(),
    stats: text("stats", { mode: "json" }).$type<unknown>().notNull(),
    budget: text("budget", { mode: "json" }).$type<unknown>().notNull(),
    manifest: text("manifest", { mode: "json" }).$type<unknown>().notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.assetId, table.n] })],
);

/** Thread aset. `seq` berurutan per aset; event delta tidak disimpan. */
export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    payload: text("payload", { mode: "json" }).$type<unknown>().notNull(),
    ts: integer("ts").notNull(),
  },
  (table) => [uniqueIndex("events_asset_seq_idx").on(table.assetId, table.seq)],
);

export const JOB_KINDS = ["build_base", "build_textured"] as const;
export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: JOB_KINDS }).notNull(),
    status: text("status", { enum: JOB_STATUSES }).notNull(),
    createdAt: integer("created_at").notNull(),
    startedAt: integer("started_at"),
    endedAt: integer("ended_at"),
    error: text("error"),
  },
  (table) => [index("jobs_status_idx").on(table.status), index("jobs_asset_idx").on(table.assetId)],
);

export const QUESTION_STATUSES = ["open", "answered", "cancelled"] as const;

export const questions = sqliteTable(
  "questions",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    /** Daftar pertanyaan (`AskQuestion[]`). */
    payload: text("payload", { mode: "json" }).$type<unknown>().notNull(),
    status: text("status", { enum: QUESTION_STATUSES }).notNull(),
    /** Jawaban yang dikirim ke Claude (`{ [pertanyaan]: jawaban }`). */
    answer: text("answer", { mode: "json" }).$type<unknown>(),
    createdAt: integer("created_at").notNull(),
    resolvedAt: integer("resolved_at"),
  },
  (table) => [index("questions_asset_idx").on(table.assetId, table.status)],
);

export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ATTACHMENT_KINDS }).notNull(),
    /** Nama file di `refs/` (dibuat server dari id, bukan dari nama unggahan). */
    path: text("path").notNull(),
    /** Nama asli unggahan (disanitasi), hanya untuk tampilan. */
    name: text("name").notNull().default("lampiran"),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("attachments_asset_idx").on(table.assetId)],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
  updatedAt: integer("updated_at").notNull(),
});
