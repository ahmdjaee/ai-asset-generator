/**
 * Pengaturan app (PLAN Tahap 11): model dan effort Claude, tier bawaan, dan budget tiap tier.
 * - Budget hanya berlaku untuk aset baru: aset menyimpan `tierSnapshot` saat dibuat.
 * - Model dan effort berlaku saat proses Claude berikutnya dimulai (aset baru, atau sesi yang dilanjutkan).
 */
import { z } from "zod";
import {
  DEFAULT_TIERS,
  TEXTURE_SIZE_OPTIONS,
  TIER_BUDGET_LIMITS,
  TIER_IDS,
  type TierBudget,
  type TierId,
} from "./limits.ts";

export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export const DEFAULT_MODEL = "claude-opus-5-5";
/** Eksplisit: bawaan Opus 5.5 adalah `medium`. */
export const DEFAULT_EFFORT: EffortLevel = "high";
export const DEFAULT_TIER_ID: TierId = "sedang";

/** Id model atau alias dari `supportedModels()` (mis. `claude-opus-5-5`, `opus`, `sonnet[1m]`). */
export const ModelId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,63}$/);

function bounded(limits: Readonly<{ min: number; max: number }>, label: string) {
  return z
    .number()
    .int()
    .min(limits.min, `${label} minimal ${limits.min}`)
    .max(limits.max, `${label} maksimal ${limits.max}`);
}

function rangeSchema(limits: Readonly<{ min: number; max: number }>, label: string) {
  const value = bounded(limits, label);
  return z
    .object({ target: value, max: value })
    .refine((range) => range.target <= range.max, `Target ${label} harus ≤ maksimal`);
}

const TextureSize = z
  .number()
  .int()
  .refine(
    (size) => (TEXTURE_SIZE_OPTIONS as readonly number[]).includes(size),
    "Ukuran tekstur tidak dikenal",
  );

/**
 * Budget satu tier yang diisi pemilik. Lebih ketat dari `TierBudgetSchema` (snapshot lama di database): ada batas
 * atas dan bawah, slot tekstur hanya yang bisa diatur, dan atlas warna wajib ada.
 */
export const EditableTierBudget: z.ZodType<TierBudget> = z.object({
  triangles: rangeSchema(TIER_BUDGET_LIMITS.triangles, "segitiga"),
  materials: bounded(TIER_BUDGET_LIMITS.materials, "material"),
  // Slot sesuai `EDITABLE_TEXTURE_SLOTS`; ditulis satu per satu supaya tipenya tetap tepat.
  textures: z
    .object({
      baseColor: TextureSize,
      normal: TextureSize.optional(),
      orm: TextureSize.optional(),
      emissive: TextureSize.optional(),
    })
    .strict(),
  webBytes: rangeSchema(TIER_BUDGET_LIMITS.webBytes, "ukuran web"),
});

export const TierBudgets = z.object({
  ringan: EditableTierBudget,
  sedang: EditableTierBudget,
  maksimal: EditableTierBudget,
}) satisfies z.ZodType<Record<TierId, TierBudget>>;
export type TierBudgets = Readonly<Record<TierId, TierBudget>>;

export const AppSettings = z.object({
  model: ModelId,
  effort: z.enum(EFFORT_LEVELS),
  defaultTier: z.enum(TIER_IDS),
  tiers: TierBudgets,
});
export type AppSettings = Readonly<{
  model: string;
  effort: EffortLevel;
  defaultTier: TierId;
  tiers: TierBudgets;
}>;

/** Body `PUT /api/settings`: pengaturan lengkap (form Pengaturan selalu mengirim semuanya). */
export const SettingsBody = AppSettings;

export const DEFAULT_SETTINGS: AppSettings = {
  model: DEFAULT_MODEL,
  effort: DEFAULT_EFFORT,
  defaultTier: DEFAULT_TIER_ID,
  tiers: DEFAULT_TIERS,
};
