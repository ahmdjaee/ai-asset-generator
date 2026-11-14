/** Repositori job berat (build). Status job dicatat dari event jalur job berat. */
import { and, eq, inArray } from "drizzle-orm";
import { type JOB_KINDS, type JOB_STATUSES, jobs } from "../schema.ts";
import type { Executor } from "./executor.ts";

export type JobKind = (typeof JOB_KINDS)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type JobRecord = typeof jobs.$inferSelect;

const UNFINISHED: JobStatus[] = ["queued", "running"];

export function insertJob(
  x: Executor,
  input: { id: string; assetId: string; kind: JobKind; now: number },
): void {
  x.insert(jobs)
    .values({
      id: input.id,
      assetId: input.assetId,
      kind: input.kind,
      status: "queued",
      createdAt: input.now,
    })
    .run();
}

export function markJobRunning(x: Executor, id: string, now: number): void {
  x.update(jobs).set({ status: "running", startedAt: now }).where(eq(jobs.id, id)).run();
}

/** Menutup job. Job yang sudah selesai tidak diubah lagi (event terlambat diabaikan). */
export function finishJob(
  x: Executor,
  id: string,
  outcome: { status: "succeeded" | "failed" | "cancelled"; error?: string; now: number },
): void {
  x.update(jobs)
    .set({ status: outcome.status, endedAt: outcome.now, error: outcome.error ?? null })
    .where(and(eq(jobs.id, id), inArray(jobs.status, UNFINISHED)))
    .run();
}

export function getJob(x: Executor, id: string): JobRecord | null {
  return x.select().from(jobs).where(eq(jobs.id, id)).get() ?? null;
}

export function listJobs(x: Executor, assetId: string): JobRecord[] {
  return x.select().from(jobs).where(eq(jobs.assetId, assetId)).orderBy(jobs.createdAt).all();
}

/**
 * Membatalkan job yang belum selesai: semua job (pemulihan saat start) atau job satu aset (aset dihapus).
 * Hasil: job yang dibatalkan.
 */
export function cancelUnfinishedJobs(
  x: Executor,
  now: number,
  reason: string,
  assetId?: string,
): Array<{ id: string; assetId: string }> {
  const unfinished = inArray(jobs.status, UNFINISHED);
  return x
    .update(jobs)
    .set({ status: "cancelled", endedAt: now, error: reason })
    .where(assetId === undefined ? unfinished : and(unfinished, eq(jobs.assetId, assetId)))
    .returning({ id: jobs.id, assetId: jobs.assetId })
    .all();
}
