/**
 * Bentuk respons `/api/health/auth` dan `/api/health/runtime` (PLAN Tahap 11). Dipakai server, web, dan tes.
 */
import { z } from "zod";
import { EFFORT_LEVELS } from "./settings.ts";

export const ModelOption = z.object({
  /** Nilai untuk opsi `model` SDK; sering berupa alias (`opus`, `sonnet[1m]`). */
  value: z.string(),
  /** Id lengkap yang dicakup alias itu (`claude-opus-5-5`), supaya id yang tersimpan tetap cocok. */
  resolvedModel: z.string().nullable(),
  displayName: z.string(),
  description: z.string(),
  /** Kosong = model tanpa effort; `undefined` di SDK dianggap semua level. */
  efforts: z.array(z.enum(EFFORT_LEVELS)),
});
export type ModelOption = z.infer<typeof ModelOption>;

/** Pilihan model yang mencakup `model` tersimpan: sama persis, atau alias yang `resolvedModel`-nya sama. */
export function findModel<T extends Readonly<{ value: string; resolvedModel?: string | null }>>(
  models: readonly T[],
  model: string,
): T | undefined {
  return (
    models.find((entry) => entry.value === model) ?? models.find((entry) => entry.resolvedModel === model)
  );
}

/**
 * - `ok`: login Claude Code dengan langganan (tanpa API key);
 * - `logged_out`: CLI berjalan, tetapi belum ada akun yang login;
 * - `api_key`: CLI memakai API key (app ini menolaknya, AGENTS.md §6);
 * - `error`: CLI tidak bisa dijalankan atau tidak menjawab.
 */
export const AuthStatus = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("ok"),
    email: z.string(),
    subscription: z.string().nullable(),
    organization: z.string().nullable(),
    models: z.array(ModelOption),
    checkedAt: z.number(),
  }),
  z.object({ state: z.literal("logged_out"), checkedAt: z.number() }),
  z.object({ state: z.literal("api_key"), checkedAt: z.number() }),
  z.object({ state: z.literal("error"), message: z.string(), checkedAt: z.number() }),
]);
export type AuthStatus = z.infer<typeof AuthStatus>;

const Check = z.object({ ok: z.boolean(), detail: z.string().nullable() });

/**
 * Runtime 3D. `driver: "fixture"` (mode palsu) selalu siap. `ready` = build bisa berjalan: Docker terjangkau dan image
 * ada. Renderer dan pustaka material dilaporkan terpisah karena tidak menghalangi bentuk dasar.
 */
export const RuntimeStatus = z.object({
  driver: z.enum(["docker", "fixture"]),
  ready: z.boolean(),
  docker: Check,
  image: z.object({ tag: z.string(), present: z.boolean() }),
  blender: z.string().nullable(),
  renderer: Check,
  materials: z.object({ count: z.number().int().min(0) }),
  build: z.object({
    state: z.enum(["idle", "building", "failed"]),
    startedAt: z.number().nullable(),
    /** Waktu build terakhir selesai atau gagal (Pengaturan: "gagal pukul …"). */
    endedAt: z.number().nullable(),
    error: z.string().nullable(),
  }),
  checkedAt: z.number(),
});
export type RuntimeStatus = z.infer<typeof RuntimeStatus>;
