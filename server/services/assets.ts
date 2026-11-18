/**
 * Service aset (PLAN Tahap 5): satu-satunya pintu aksi pemilik dan pencatat event sesi Claude.
 * - Aksi pemilik → `AssetStore.apply` (`transition()`, gerbang di server) → efek: kirim pesan ke Claude / interrupt.
 * - Event sesi (runner + tool `forge`) dicatat ke thread, lalu menggerakkan status: kartu pertanyaan, job, giliran
 *   selesai, gagal (batas pemakaian, sesi gagal).
 * - Sesi Claude dibuat lewat port `AgentFactory` (lapisan agent); service tidak meng-import `server/agent`.
 * - Pemulihan saat start: job berjalan dibatalkan, kartu pertanyaan ditutup, aset yang sedang berjalan menjadi
 *   `interrupted` dengan aksi Lanjutkan.
 */
import { randomUUID } from "node:crypto";
import { chmod, copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent, AttachmentRef } from "../../shared/agent-events.ts";
import type { OwnerAction } from "../../shared/asset-events.ts";
import type { BuildProgressView } from "../../shared/asset-list.ts";
import {
  ASSET_NAME_MAX_CHARS,
  DEFAULT_TIERS,
  MESSAGE_MAX_CHARS,
  type TierBudget,
  type TierId,
} from "../../shared/limits.ts";
import { codePointLength, truncate } from "../../shared/text.ts";
import type { Db } from "../db/client.ts";
import {
  type AssetRecord,
  getAsset,
  insertAsset,
  listAssetsByRunState,
  markAssetDeleted,
  renameAsset,
  setSessionId,
} from "../db/repos/assets.ts";
import {
  type AttachmentRecord,
  copyAttachments,
  deleteAttachments,
  getAttachment,
  insertAttachment,
} from "../db/repos/attachments.ts";
import { lastRequest } from "../db/repos/events.ts";
import { transact } from "../db/repos/executor.ts";
import { cancelUnfinishedJobs, finishJob, insertJob, markJobRunning } from "../db/repos/jobs.ts";
import { cancelOpenQuestions, insertQuestion, resolveQuestion } from "../db/repos/questions.ts";
import { copyVersions } from "../db/repos/versions.ts";
import type { AnswerResult, AnswerSubmission } from "../domain/answers.ts";
import {
  type AssetAction,
  type AssetState,
  type Effect,
  type Outbound,
  type OutboundContext,
  transition,
} from "../domain/status.ts";
import { assetDirFor } from "./asset-queries.ts";
import { AssetStore, type AssetWorkspace, type Clock, EventLog } from "./asset-store.ts";
import {
  decalFileName,
  type PreparedAttachment,
  prepareUploads,
  removeFiles,
  type UploadFile,
  writeAttachmentFiles,
} from "./attachments.ts";
import type { EventBus } from "./bus.ts";
import { assetNotFound, ServiceError } from "./errors.ts";
import { listVersions } from "./versions.ts";

/** Sesi Claude satu aset, dari lapisan agent (`createAssetSession`). */
export interface AssetAgent {
  readonly sessionId: string | undefined;
  /** Pesan yang belum terkirim ke Claude. */
  readonly queued: number;
  deliver(message: Outbound, context?: OutboundContext): void;
  interrupt(): Promise<void>;
  answer(questionId: string, submission: AnswerSubmission): AnswerResult;
  close(): void;
}

export type AgentFactoryInput = Readonly<{
  asset: AssetWorkspace;
  store: AssetStore;
  sessionId?: string;
  emit: (event: AgentEvent) => void;
  /** Error teknis sesi (proses Claude gagal dimulai atau mati): detail untuk log, bukan untuk pemilik. */
  onError: (error: unknown, op: string) => void;
}>;

export type AgentFactory = (input: AgentFactoryInput) => Promise<AssetAgent>;

export type AssetServiceDeps = Readonly<{
  db: Db;
  bus: EventBus;
  now: Clock;
  /** Folder data app; aset di `<dataDir>/assets/<id>`. */
  dataDir: string;
  createAgent: AgentFactory;
  newId?: () => string;
  /** Budget tier untuk aset BARU (Pengaturan menyusul di Tahap 11). Aset lama memakai snapshot-nya. */
  tierBudget?: (tierId: TierId) => TierBudget;
  /** Giliran gagal karena Claude belum login: status akun yang di-cache perlu diperiksa ulang. */
  onAuthRequired?: () => void;
  /**
   * Runtime 3D siap (Docker terjangkau, image ada)? Aksi yang mengirim pesan ke Claude ditolak bila belum, supaya
   * kuota tidak terpakai untuk build yang pasti gagal. Bawaan: selalu siap.
   */
  runtimeReady?: () => Promise<boolean>;
  /** Error yang tidak bisa dikembalikan ke pemanggil (event sesi, pembersihan file). */
  onError?: (error: unknown, context: Readonly<{ assetId?: string; op: string }>) => void;
  /** Build berhasil membuat versi baru (mis. thumbnail Gudang dibuat di latar). */
  onVersionCreated?: (assetId: string, version: number) => void;
  /**
   * Setelah aset ditandai terhapus, sebelum foldernya dihapus: menunggu pekerjaan turunan aset itu yang masih
   * berjalan (render thumbnail, pembuatan ekspor), supaya tidak ada yang menulis ke folder yang sedang dihapus.
   */
  beforeRemoveDir?: (assetId: string) => Promise<void>;
}>;

/** Aksi yang sudah diterapkan; efeknya dijalankan setelahnya. */
type Applied = Readonly<{ before: AssetState; effects: readonly Effect[] }>;

export type CreateAssetInput = Readonly<{
  prompt: string;
  tierId: TierId;
  name?: string;
  /** Lampiran pesan pertama (diproses dan divalidasi sebelum aset dibuat). */
  files?: readonly UploadFile[];
}>;

export const RECOVERY_NOTICE = "Proses terputus karena server berhenti. Tekan Lanjutkan untuk melanjutkan.";
export const COPY_SUFFIX = " (salinan)";
export const SESSION_SETUP_FAILED =
  "Sesi Claude tidak bisa disiapkan. Tekan Coba lagi; detailnya ada di log server.";

type Live = {
  readonly store: AssetStore;
  readonly agent: Promise<AssetAgent>;
  ready: AssetAgent | undefined;
};

/** Nama aset dari prompt: baris pertama, maks. `ASSET_NAME_MAX_CHARS` (per code point). */
export function nameFromPrompt(prompt: string): string {
  const line = (prompt.split("\n")[0] ?? "").trim();
  if (codePointLength(line) <= ASSET_NAME_MAX_CHARS) return line.toWellFormed();
  return `${truncate(line, ASSET_NAME_MAX_CHARS - 1).trimEnd()}…`;
}

/**
 * Nama aset dari pemilik: tanpa karakter kontrol dan surrogate tunggal, tidak kosong, maks. `ASSET_NAME_MAX_CHARS`
 * per code point (sama dengan `nameFromPrompt` dan dialog Ganti nama).
 */
function assetName(name: string): string {
  const clean = name
    .replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean === "") throw new ServiceError("INVALID_NAME", "Nama aset tidak boleh kosong.");
  if (codePointLength(clean) > ASSET_NAME_MAX_CHARS) {
    throw new ServiceError("INVALID_NAME", `Nama aset maksimal ${ASSET_NAME_MAX_CHARS} karakter.`);
  }
  return clean;
}

function attachmentRefs(prepared: readonly PreparedAttachment[]): AttachmentRef[] {
  return prepared.map(({ id, kind, name, file, decal }) => ({ id, kind, name, file, decal }));
}

/** Event `user` untuk pesan pemilik yang tidak sempat dikirim ke Claude (sesi gagal disiapkan). */
function undeliveredOwnerEvent(message: Extract<Outbound, { kind: "owner" }>): AgentEvent {
  const attachments = (message.attachments ?? []).map(({ id, kind, name }) => ({ id, kind, name }));
  return {
    type: "user",
    uuid: randomUUID(),
    text: message.text,
    ...(attachments.length === 0 ? {} : { attachments }),
  };
}

/** Lampiran tersimpan → rujukan untuk catatan ke Claude (nama file di `refs/`, varian decal untuk gambar). */
function storedRef(record: AttachmentRecord): AttachmentRef {
  return {
    id: record.id,
    kind: record.kind,
    name: record.name,
    file: record.path,
    decal: record.kind === "image" ? decalFileName(record.id) : null,
  };
}

function ownerAction(
  type: "message" | "revise",
  text: string,
  prepared: readonly PreparedAttachment[],
): AssetAction {
  return prepared.length === 0 ? { type, text } : { type, text, attachments: attachmentRefs(prepared) };
}

function attachmentRow(assetId: string, attachment: PreparedAttachment, now: number) {
  return {
    id: attachment.id,
    assetId,
    kind: attachment.kind,
    path: attachment.file,
    name: attachment.name,
    mime: attachment.mime,
    size: attachment.size,
    sha256: attachment.sha256,
    createdAt: now,
  };
}

function messageText(text: string): string {
  const trimmed = text.trim();
  if (trimmed === "") throw new ServiceError("EMPTY_MESSAGE", "Pesan tidak boleh kosong.");
  if (trimmed.length > MESSAGE_MAX_CHARS) {
    throw new ServiceError("MESSAGE_TOO_LONG", `Pesan maksimal ${MESSAGE_MAX_CHARS} karakter.`);
  }
  return trimmed;
}

/**
 * Salin pohon folder: hanya folder dan file biasa (symlink dan lainnya dilewati). `skipHidden`: nama berawalan titik
 * dilewati, yaitu staging versi (`.staging-*`) dan file sementara turunan (`.x.tmp`) yang masih ditulis.
 */
async function copyTree(source: string, target: string, skipHidden = false): Promise<void> {
  const entries = await readdir(source, { withFileTypes: true }).catch(() => null);
  if (entries === null) return;
  await mkdir(target, { recursive: true });
  for (const entry of entries) {
    if (skipHidden && entry.name.startsWith(".")) continue;
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) await copyTree(from, to, skipHidden);
    else if (entry.isFile()) await copyFile(from, to);
  }
}

/** Bagian folder aset yang disalin saat duplikat; `true` = folder internal (lewati staging dan file sementara). */
const DUPLICATE_PARTS: ReadonlyArray<readonly [string, boolean]> = [
  ["refs", false],
  ["work", false],
  ["derived", true],
  ["versions", true],
];

/** Folder versi read-only (0555/0444) supaya write-once; salinannya dikunci sama. */
async function lockVersions(versionsDir: string): Promise<void> {
  const entries = await readdir(versionsDir, { withFileTypes: true }).catch(() => null);
  for (const entry of entries ?? []) {
    if (!entry.isDirectory()) continue;
    const dir = join(versionsDir, entry.name);
    for (const file of await readdir(dir, { withFileTypes: true })) {
      if (file.isFile()) await chmod(join(dir, file.name), 0o444);
    }
    await chmod(dir, 0o555);
  }
}

/** Menghapus folder aset; folder versi dibuka dulu (`chmod u+w`) karena read-only. */
async function removeAssetDir(assetDir: string): Promise<void> {
  const versionsDir = join(assetDir, "versions");
  const entries = await readdir(versionsDir, { withFileTypes: true }).catch(() => null);
  for (const entry of entries ?? []) {
    if (entry.isDirectory()) await chmod(join(versionsDir, entry.name), 0o755);
  }
  await rm(assetDir, { recursive: true, force: true, maxRetries: 3 });
}

export class AssetService {
  readonly #deps: AssetServiceDeps;
  readonly #log: EventLog;
  readonly #live = new Map<string, Live>();
  /** Progres build yang sedang berjalan per aset (kartu Gudang). Hanya di memori, selama proses server hidup. */
  readonly #progress = new Map<string, BuildProgressView>();
  readonly #newId: () => string;

  constructor(deps: AssetServiceDeps) {
    this.#deps = deps;
    this.#log = new EventLog(deps);
    this.#newId = deps.newId ?? randomUUID;
  }

  /** `data/assets/<id>`; id dicek supaya tidak keluar dari folder aset. */
  assetDir(assetId: string): string {
    return assetDirFor(this.#deps.dataDir, assetId);
  }

  get(assetId: string): AssetRecord {
    const record = getAsset(this.#deps.db, assetId);
    if (record === null) throw assetNotFound(assetId);
    return record;
  }

  #workspace(record: AssetRecord): AssetWorkspace {
    return { id: record.id, assetDir: this.assetDir(record.id), tierId: record.tierId, tier: record.tier };
  }

  #store(assetId: string): AssetStore {
    const live = this.#live.get(assetId);
    if (live !== undefined) return live.store;
    this.get(assetId);
    return new AssetStore(this.#deps, assetId);
  }

  #ensureLive(assetId: string): Live {
    const existing = this.#live.get(assetId);
    if (existing !== undefined) return existing;
    const record = this.get(assetId);
    const store = new AssetStore(this.#deps, assetId);
    const agent = this.#deps.createAgent({
      asset: this.#workspace(record),
      store,
      ...(record.sessionId === null ? {} : { sessionId: record.sessionId }),
      emit: (event) => this.#onAgentEvent(assetId, event),
      onError: (error, op) => this.#deps.onError?.(error, { assetId, op }),
    });
    const live: Live = { store, agent, ready: undefined };
    this.#live.set(assetId, live);
    agent.then(
      (ready) => {
        live.ready = ready;
      },
      () => {
        if (this.#live.get(assetId) === live) this.#live.delete(assetId);
      },
    );
    return live;
  }

  // ── Aksi pemilik ────────────────────────────────────────────────────────────────────────────────────────────

  async create(input: CreateAssetInput): Promise<AssetRecord> {
    const prompt = messageText(input.prompt);
    const name =
      input.name === undefined || input.name.trim() === "" ? nameFromPrompt(prompt) : assetName(input.name);
    const id = this.#newId();
    await this.#requireRuntime();
    const prepared = await prepareUploads(input.files ?? [], this.#newId);
    const tier = (this.#deps.tierBudget ?? ((tierId: TierId) => DEFAULT_TIERS[tierId]))(input.tierId);
    const assetDir = this.assetDir(id);
    await mkdir(join(assetDir, "work"), { recursive: true });
    await mkdir(join(assetDir, "refs"), { recursive: true });
    try {
      await writeAttachmentFiles(join(assetDir, "refs"), prepared);
      const now = this.#deps.now();
      transact(this.#deps.db, (tx) => {
        insertAsset(tx, {
          id,
          name: truncate(name, ASSET_NAME_MAX_CHARS),
          prompt,
          tierId: input.tierId,
          tier,
          now,
        });
        for (const attachment of prepared) insertAttachment(tx, attachmentRow(id, attachment, now));
      });
    } catch (error) {
      await removeAssetDir(assetDir).catch((cleanupError: unknown) =>
        this.#deps.onError?.(cleanupError, { assetId: id, op: "bersihkan aset yang gagal dibuat" }),
      );
      throw error;
    }
    this.#deps.bus.publishGlobal({ type: "asset", assetId: id, change: "created" });
    await this.#act(id, ownerAction("message", prompt, prepared));
    return this.get(id);
  }

  /** Pesan pemilik. Saat review = permintaan revisi; saat selesai = membuka lagi tahap tekstur. */
  async sendMessage(assetId: string, text: string, files: readonly UploadFile[] = []): Promise<void> {
    return this.#ownerMessage(assetId, "message", messageText(text), files);
  }

  /** Revisi eksplisit dari tombol review (hanya saat REVIEW). */
  async revise(assetId: string, text: string, files: readonly UploadFile[] = []): Promise<void> {
    return this.#ownerMessage(assetId, "revise", messageText(text), files);
  }

  async rename(assetId: string, name: string): Promise<AssetRecord> {
    this.get(assetId);
    renameAsset(this.#deps.db, assetId, assetName(name), this.#deps.now());
    this.#deps.bus.publishGlobal({ type: "asset", assetId, change: "updated" });
    return this.get(assetId);
  }

  async approve(assetId: string, note?: string): Promise<void> {
    const trimmed = note?.trim();
    const action: AssetAction =
      trimmed === undefined || trimmed === ""
        ? { type: "approve" }
        : { type: "approve", note: messageText(trimmed) };
    return this.#act(assetId, action, "approve");
  }

  async finish(assetId: string): Promise<void> {
    return this.#act(assetId, { type: "finish" }, "finish");
  }

  async changeShape(assetId: string, text: string): Promise<void> {
    return this.#act(assetId, { type: "change_shape", text: messageText(text) }, "change_shape");
  }

  async stop(assetId: string): Promise<void> {
    return this.#act(assetId, { type: "stop" }, "stop");
  }

  async retry(assetId: string): Promise<void> {
    return this.#act(assetId, { type: "retry" }, "retry");
  }

  async resume(assetId: string): Promise<void> {
    return this.#act(assetId, { type: "resume" }, "resume");
  }

  async answer(assetId: string, questionId: string, submission: AnswerSubmission): Promise<void> {
    this.get(assetId);
    const live = this.#live.get(assetId);
    const agent = live === undefined ? null : await live.agent;
    const result: AnswerResult = agent?.answer(questionId, submission) ?? {
      ok: false,
      code: "QUESTION_NOT_FOUND",
      message: "Pertanyaan ini sudah tidak terbuka.",
    };
    if (!result.ok) throw new ServiceError(result.code, result.message);
  }

  /**
   * Duplikat penuh: status, brief, versi (file + indeks), lampiran, dan folder kerja ikut; riwayat thread dan sesi
   * Claude tidak. Pesan pertama ke salinan membuka sesi baru dengan ringkasan keadaan aset.
   *
   * Boleh saat build berjalan. Status dibaca sebelum folder disalin, jadi versi terkininya pasti ikut tersalin; indeks
   * versi hanya untuk folder versi yang benar-benar tersalin (versi yang selesai saat menyalin tidak ikut).
   */
  async duplicate(assetId: string): Promise<AssetRecord> {
    const source = this.get(assetId);
    const id = this.#newId();
    const sourceDir = this.assetDir(source.id);
    const targetDir = this.assetDir(id);
    const state: AssetState = { ...source.state, runState: "idle", lastError: null, buildsThisMessage: 0 };
    try {
      for (const [part, internal] of DUPLICATE_PARTS) {
        await copyTree(join(sourceDir, part), join(targetDir, part), internal);
      }
      await mkdir(join(targetDir, "work"), { recursive: true });
      await mkdir(join(targetDir, "refs"), { recursive: true });
      await lockVersions(join(targetDir, "versions"));
      const copied = new Set(await listVersions(targetDir));
      const now = this.#deps.now();
      transact(this.#deps.db, (tx) => {
        insertAsset(tx, {
          id,
          name: `${truncate(source.name, ASSET_NAME_MAX_CHARS - COPY_SUFFIX.length)}${COPY_SUFFIX}`,
          prompt: source.prompt,
          tierId: source.tierId,
          tier: source.tier,
          now,
          state,
        });
        copyVersions(tx, source.id, id, copied);
        copyAttachments(tx, source.id, id, this.#newId);
      });
    } catch (error) {
      await removeAssetDir(targetDir).catch((cleanupError: unknown) =>
        this.#deps.onError?.(cleanupError, { assetId: id, op: "bersihkan duplikat yang gagal" }),
      );
      throw error;
    }
    this.#log.record(id, {
      type: "notice",
      text: `Disalin dari "${source.name}". Riwayat percakapan tidak ikut; pesan berikutnya membuka sesi Claude baru dengan ringkasan keadaan aset.`,
    });
    this.#deps.bus.publishGlobal({ type: "asset", assetId: id, change: "created" });
    return this.get(id);
  }

  /** Soft delete: baris aset ditandai terhapus, sesi dan build dihentikan, lalu folder aset dihapus. */
  async delete(assetId: string): Promise<void> {
    this.get(assetId);
    const live = this.#live.get(assetId);
    this.#live.delete(assetId);
    if (live !== undefined) (await live.agent.catch(() => null))?.close();
    const now = this.#deps.now();
    transact(this.#deps.db, (tx) => {
      markAssetDeleted(tx, assetId, now);
      cancelUnfinishedJobs(tx, now, "Aset dihapus.", assetId);
    });
    this.#progress.delete(assetId);
    this.#deps.bus.publishGlobal({ type: "asset", assetId, change: "deleted" });
    await this.#deps
      .beforeRemoveDir?.(assetId)
      .catch((error: unknown) => this.#deps.onError?.(error, { assetId, op: "tunggu pekerjaan aset" }));
    await removeAssetDir(this.assetDir(assetId)).catch((error: unknown) =>
      this.#deps.onError?.(error, { assetId, op: "hapus folder aset" }),
    );
  }

  /** Progres build yang sedang berjalan, atau `null` bila tidak ada build. */
  buildProgress(assetId: string): BuildProgressView | null {
    return this.#progress.get(assetId) ?? null;
  }

  /** Jalur job berat melaporkan job mulai berjalan (container dimulai). */
  jobStarted(jobId: string): void {
    markJobRunning(this.#deps.db, jobId, this.#deps.now());
  }

  /** Pemulihan saat start, sebelum aksi apa pun. */
  recover(): void {
    const now = this.#deps.now();
    const reason = "Server berhenti saat job berjalan.";
    for (const job of cancelUnfinishedJobs(this.#deps.db, now, reason)) {
      this.#log.record(job.assetId, { type: "build_finished", jobId: job.id, ok: false, code: "CANCELLED" });
    }
    for (const question of cancelOpenQuestions(this.#deps.db, now)) {
      this.#log.record(question.assetId, {
        type: "question_resolved",
        questionId: question.id,
        answers: {},
        cancelled: true,
      });
    }
    for (const asset of listAssetsByRunState(this.#deps.db, ["running", "waiting_user"])) {
      this.#log.record(asset.id, { type: "notice", text: RECOVERY_NOTICE });
      new AssetStore(this.#deps, asset.id).apply({ type: "interrupted" });
    }
  }

  /** Server berhenti: semua sesi ditutup (status di database dipulihkan saat start berikutnya). */
  async close(): Promise<void> {
    const lives = [...this.#live.values()];
    this.#live.clear();
    for (const live of lives) (await live.agent.catch(() => null))?.close();
  }

  // ── Jalur aksi dan efek ─────────────────────────────────────────────────────────────────────────────────────

  async #act(assetId: string, action: AssetAction, recorded?: OwnerAction): Promise<void> {
    await this.#gateRuntime(assetId, action);
    const applied = this.#apply(assetId, action, recorded);
    for (const effect of applied.effects) await this.#effect(assetId, effect, applied.before);
  }

  /**
   * Gerbang domain dicek dulu (kodenya lebih spesifik), lalu runtime bila aksi akan mengirim pesan ke Claude.
   * Status masih bisa berubah selama `await`; `#apply` memeriksa ulang.
   */
  async #gateRuntime(assetId: string, action: AssetAction): Promise<void> {
    const gate = transition(this.get(assetId).state, action);
    if (!gate.ok) throw new ServiceError(gate.code, gate.message);
    if (gate.effects.some((effect) => effect.type === "deliver")) await this.#requireRuntime();
  }

  async #requireRuntime(): Promise<void> {
    const ready = this.#deps.runtimeReady;
    if (ready !== undefined && !(await ready()))
      throw new ServiceError(
        "RUNTIME_NOT_READY",
        "Runtime 3D belum siap (Docker mati atau image belum dibangun). Buka Pengaturan untuk memperbaikinya.",
      );
  }

  /** Menerapkan aksi (ServiceError bila ditolak) dan mencatat aksi pemilik; efek dijalankan pemanggil. */
  #apply(assetId: string, action: AssetAction, recorded?: OwnerAction): Applied {
    const store = this.#store(assetId);
    const before = store.read();
    const result = store.apply(action);
    if (!result.ok) throw new ServiceError(result.code, result.message);
    if (recorded !== undefined) {
      const version =
        recorded === "approve"
          ? result.state.approvedBaseVersion
          : recorded === "finish"
            ? result.state.currentVersion
            : null;
      this.#log.record(assetId, {
        type: "action",
        action: recorded,
        ...(version === null ? {} : { version }),
      });
    }
    return { before, effects: result.effects };
  }

  /**
   * Pesan pemilik dengan lampiran:
   * 1. gerbang dicek dulu (murah), supaya gambar tidak diproses untuk aksi yang pasti ditolak;
   * 2. unggahan divalidasi dan diproses di memori;
   * 3. file + baris lampiran ditulis, lalu aksi diterapkan.
   * Bila aksi ternyata ditolak (status berubah selama langkah 2–3), lampiran dibatalkan lagi.
   */
  async #ownerMessage(
    assetId: string,
    type: "message" | "revise",
    text: string,
    files: readonly UploadFile[],
  ): Promise<void> {
    if (files.length === 0) return this.#act(assetId, ownerAction(type, text, []));
    await this.#gateRuntime(assetId, ownerAction(type, text, []));
    const prepared = await prepareUploads(files, this.#newId);
    const action = ownerAction(type, text, prepared);
    const refsDir = join(this.assetDir(assetId), "refs");
    const ids = prepared.map((attachment) => attachment.id);
    let written: readonly string[] = [];
    let touched = false;
    let applied: Applied;
    try {
      // Aset bisa dihapus selama gambar diproses: jangan membuat foldernya lagi.
      this.get(assetId);
      touched = true;
      await mkdir(refsDir, { recursive: true });
      written = await writeAttachmentFiles(refsDir, prepared);
      const now = this.#deps.now();
      transact(this.#deps.db, (tx) => {
        for (const attachment of prepared) insertAttachment(tx, attachmentRow(assetId, attachment, now));
      });
      applied = this.#apply(assetId, action);
    } catch (error) {
      await this.#discardAttachments(assetId, ids, written);
      // Aset terhapus di tengah jalan (setelah folder dibuat lagi): sisa folder ikut dibersihkan.
      if (touched && getAsset(this.#deps.db, assetId) === null) {
        await removeAssetDir(this.assetDir(assetId)).catch((cleanupError: unknown) =>
          this.#deps.onError?.(cleanupError, { assetId, op: "hapus sisa folder aset" }),
        );
      }
      throw error;
    }
    for (const effect of applied.effects) await this.#effect(assetId, effect, applied.before);
  }

  /** Kompensasi lampiran yang sudah ditulis; error pembersihan dilaporkan, error asli tetap dilempar pemanggil. */
  async #discardAttachments(
    assetId: string,
    ids: readonly string[],
    written: readonly string[],
  ): Promise<void> {
    try {
      deleteAttachments(this.#deps.db, assetId, ids);
    } catch (cleanupError) {
      this.#deps.onError?.(cleanupError, { assetId, op: "batalkan baris lampiran" });
    }
    await removeFiles(written).catch((cleanupError: unknown) =>
      this.#deps.onError?.(cleanupError, { assetId, op: "hapus file lampiran" }),
    );
  }

  /** Konteks lanjutkan/coba lagi: permintaan terakhir beserta lampirannya (dicari lagi di tabel lampiran). */
  #retryContext(assetId: string, before: AssetState): OutboundContext {
    const request = lastRequest(this.#deps.db, assetId);
    if (request === null) return { lastError: before.lastError };
    const attachments = request.attachments.flatMap((chip) => {
      const record = getAttachment(this.#deps.db, assetId, chip.id);
      return record === null ? [] : [storedRef(record)];
    });
    return { lastRequest: { text: request.text, attachments }, lastError: before.lastError };
  }

  async #effect(assetId: string, effect: Effect, before: AssetState): Promise<void> {
    if (effect.type === "interrupt") {
      const live = this.#live.get(assetId);
      const agent = live === undefined ? null : await live.agent.catch(() => null);
      await agent?.interrupt();
      return;
    }
    const context: OutboundContext =
      effect.message.kind === "resume" || effect.message.kind === "retry"
        ? this.#retryContext(assetId, before)
        : {};
    let agent: AssetAgent;
    try {
      agent = await this.#ensureLive(assetId).agent;
    } catch (error) {
      // Sesi tidak bisa disiapkan (mis. folder aset rusak): giliran gagal dan pemilik bisa Coba lagi. Aksi pemilik
      // sendiri sudah tercatat, jadi tidak dilempar ke pemanggil; detail teknis hanya ke log.
      this.#deps.onError?.(error, { assetId, op: "siapkan sesi Claude" });
      // Pesan pemilik belum sempat masuk antrean Claude: tetap dicatat di thread, supaya terlihat dan dikutip
      // (bersama lampirannya) saat Coba lagi.
      if (effect.message.kind === "owner") this.#log.record(assetId, undeliveredOwnerEvent(effect.message));
      this.#store(assetId).apply({
        type: "failed",
        error: { code: "SESSION_FAILED", message: SESSION_SETUP_FAILED, at: this.#deps.now() },
      });
      return;
    }
    agent.deliver(effect.message, context);
  }

  // ── Event sesi Claude ───────────────────────────────────────────────────────────────────────────────────────

  #onAgentEvent(assetId: string, event: AgentEvent): void {
    const live = this.#live.get(assetId);
    // Event dari sesi yang sudah ditutup (aset dihapus, server berhenti) diabaikan.
    if (live === undefined) return;
    try {
      this.#recordAgentEvent(assetId, live, event);
    } catch (error) {
      this.#deps.onError?.(error, { assetId, op: `event ${event.type}` });
    }
  }

  /**
   * Progres build untuk Gudang: mulai di 0%, diperbarui `build_progress`, dihapus saat build selesai. Selesainya build
   * diumumkan sebagai perubahan aset, supaya kartu yang build-nya gagal tidak tertahan di persen terakhir.
   */
  #trackProgress(assetId: string, event: AgentEvent): void {
    const bus = this.#deps.bus;
    if (event.type === "build_finished") {
      if (this.#progress.delete(assetId)) bus.publishGlobal({ type: "asset", assetId, change: "updated" });
      if (event.ok && event.version !== undefined) this.#deps.onVersionCreated?.(assetId, event.version);
      return;
    }
    let next: BuildProgressView;
    if (event.type === "build_started") next = { stage: event.stage, pct: 0 };
    else if (event.type === "build_progress") {
      const current = this.#progress.get(assetId);
      if (current === undefined) return;
      next = { stage: current.stage, pct: Math.round(Math.min(100, Math.max(0, event.pct))) };
      if (next.pct === current.pct) return;
    } else return;
    this.#progress.set(assetId, next);
    bus.publishGlobal({ type: "progress", assetId, ...next });
  }

  #recordAgentEvent(assetId: string, live: Live, event: AgentEvent): void {
    const db = this.#deps.db;
    const now = this.#deps.now();
    switch (event.type) {
      case "init":
        setSessionId(db, assetId, event.sessionId, now);
        break;
      case "question":
        insertQuestion(db, { id: event.questionId, assetId, questions: event.questions, now });
        break;
      case "question_resolved":
        resolveQuestion(db, event.questionId, {
          status: event.cancelled ? "cancelled" : "answered",
          ...(event.cancelled ? {} : { answer: event.answers }),
          now,
        });
        break;
      case "build_started":
        insertJob(db, {
          id: event.jobId,
          assetId,
          kind: event.stage === "base" ? "build_base" : "build_textured",
          now,
        });
        break;
      case "build_finished":
        finishJob(db, event.jobId, {
          status: event.ok ? "succeeded" : event.code === "CANCELLED" ? "cancelled" : "failed",
          ...(event.ok || event.code === undefined ? {} : { error: event.code }),
          now,
        });
        break;
      default:
        break;
    }
    this.#log.record(assetId, event);
    this.#trackProgress(assetId, event);
    const store = live.store;
    switch (event.type) {
      case "question":
        store.apply({ type: "question_opened" });
        break;
      case "question_resolved":
        store.apply({ type: "question_closed" });
        break;
      case "error":
        if (event.code === "AUTH_REQUIRED") this.#deps.onAuthRequired?.();
        if (
          event.code === "USAGE_LIMIT" ||
          event.code === "AUTH_REQUIRED" ||
          event.code === "SESSION_FAILED"
        ) {
          store.apply({
            type: "failed",
            error: {
              code: event.code,
              message: event.message,
              at: now,
              ...(event.resetsAt === undefined ? {} : { resetsAt: event.resetsAt }),
            },
          });
        }
        break;
      case "result":
        if (event.interrupted) store.apply({ type: "turn_ended", outcome: "interrupted" });
        else if (event.isError) {
          store.apply({
            type: "turn_ended",
            outcome: "error",
            error: {
              code: "TURN_FAILED",
              message: `Giliran Claude berakhir dengan error (${event.subtype}).`,
              at: now,
            },
          });
          // Pesan berikutnya yang masih antre tetap dikirim (giliran baru).
        } else if ((live.ready?.queued ?? 0) === 0) {
          // Masih ada pesan antre (mis. menunggu slot pool): aset tetap berjalan.
          store.apply({ type: "turn_ended", outcome: "success" });
        }
        break;
      default:
        break;
    }
  }
}
