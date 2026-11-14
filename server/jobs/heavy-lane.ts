/**
 * Jalur job berat: build Blender, optimasi, dan render berjalan satu per satu (RAM mesin terbatas).
 * - Antrean FIFO; event `queued` membawa jumlah job di depannya (berjalan + antre).
 * - Batal lewat `cancel(jobId)` atau `AbortSignal` pemanggil, baik saat antre maupun saat berjalan.
 * - Slot baru dilepas setelah pekerjaan benar-benar selesai (container sudah di-kill), bukan saat dibatalkan.
 */
import { AbortedWhileWaiting, Semaphore } from "./semaphore.ts";

export type LaneEvent =
  | { type: "queued"; jobId: string; kind: string; ahead: number }
  | { type: "started"; jobId: string; kind: string }
  | { type: "progress"; jobId: string; step: string; pct: number }
  | { type: "finished"; jobId: string; durationMs: number }
  | { type: "failed"; jobId: string; durationMs: number; message: string }
  | { type: "cancelled"; jobId: string; stage: "queued" | "running" };

export type JobContext = Readonly<{
  jobId: string;
  /** Aktif saat job dibatalkan; pekerjaan wajib berhenti (mis. `runJob` mem-kill container). */
  signal: AbortSignal;
  progress: (step: string, pct: number) => void;
}>;

export type JobSpec = Readonly<{ jobId: string; kind: string; signal?: AbortSignal }>;

export class JobCancelledError extends Error {
  readonly code = "CANCELLED";
  readonly jobId: string;

  constructor(jobId: string) {
    super(`Job ${jobId} dibatalkan`);
    this.name = "JobCancelledError";
    this.jobId = jobId;
  }
}

export class DuplicateJobError extends Error {
  readonly code = "DUPLICATE_JOB";

  constructor(jobId: string) {
    super(`Job ${jobId} sudah ada di jalur`);
    this.name = "DuplicateJobError";
  }
}

type Entry = { kind: string; controller: AbortController; running: boolean };

export class HeavyLane {
  private readonly semaphore: Semaphore;
  private readonly now: () => number;
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<(event: LaneEvent) => void>();

  constructor(options: { concurrency?: number; now?: () => number } = {}) {
    this.semaphore = new Semaphore(options.concurrency ?? 1);
    this.now = options.now ?? (() => performance.now());
  }

  /** Mendaftarkan pendengar event; hasilnya fungsi untuk berhenti mendengar. */
  on(listener: (event: LaneEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get queued(): string[] {
    return [...this.entries].filter(([, entry]) => !entry.running).map(([id]) => id);
  }

  get running(): string[] {
    return [...this.entries].filter(([, entry]) => entry.running).map(([id]) => id);
  }

  /** Membatalkan job yang antre atau berjalan. `false` bila job tidak dikenal. */
  cancel(jobId: string): boolean {
    const entry = this.entries.get(jobId);
    if (entry === undefined) return false;
    entry.controller.abort();
    return true;
  }

  async run<T>(spec: JobSpec, work: (context: JobContext) => Promise<T>): Promise<T> {
    if (this.entries.has(spec.jobId)) throw new DuplicateJobError(spec.jobId);
    const controller = new AbortController();
    const entry: Entry = { kind: spec.kind, controller, running: false };
    const forward = (): void => controller.abort();
    spec.signal?.addEventListener("abort", forward, { once: true });
    if (spec.signal?.aborted) controller.abort();
    const ahead = this.entries.size;
    this.entries.set(spec.jobId, entry);
    this.emit({ type: "queued", jobId: spec.jobId, kind: spec.kind, ahead });

    try {
      let release: () => void;
      try {
        release = await this.semaphore.acquire(controller.signal);
      } catch (error) {
        if (error instanceof AbortedWhileWaiting) {
          this.emit({ type: "cancelled", jobId: spec.jobId, stage: "queued" });
          throw new JobCancelledError(spec.jobId);
        }
        throw error;
      }
      try {
        return await this.execute(spec, entry, work);
      } finally {
        release();
      }
    } finally {
      this.entries.delete(spec.jobId);
      spec.signal?.removeEventListener("abort", forward);
    }
  }

  private async execute<T>(
    spec: JobSpec,
    entry: Entry,
    work: (context: JobContext) => Promise<T>,
  ): Promise<T> {
    entry.running = true;
    const startedAt = this.now();
    const { signal } = entry.controller;
    this.emit({ type: "started", jobId: spec.jobId, kind: spec.kind });
    const progress = (step: string, pct: number): void => {
      if (!signal.aborted) this.emit({ type: "progress", jobId: spec.jobId, step, pct });
    };
    try {
      const result = await work({ jobId: spec.jobId, signal, progress });
      if (signal.aborted) throw new JobCancelledError(spec.jobId);
      this.emit({ type: "finished", jobId: spec.jobId, durationMs: this.now() - startedAt });
      return result;
    } catch (error) {
      if (signal.aborted) {
        this.emit({ type: "cancelled", jobId: spec.jobId, stage: "running" });
        throw error instanceof JobCancelledError ? error : new JobCancelledError(spec.jobId);
      }
      const message = error instanceof Error ? error.message : String(error);
      this.emit({ type: "failed", jobId: spec.jobId, durationMs: this.now() - startedAt, message });
      throw error;
    }
  }

  private emit(event: LaneEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
