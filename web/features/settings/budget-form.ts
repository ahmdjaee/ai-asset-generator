/**
 * Form budget tier di Pengaturan: isian teks seperti yang tampil ("8.000", "1,5 MB"), diubah menjadi `TierBudgets`
 * dan dicek saat mengetik. Server memeriksa ulang dengan skema yang sama (`TierBudgets`), jadi pesan di sini hanya
 * untuk membantu; gerbangnya tetap di server.
 */

import { t } from "@/i18n/id.ts";
import { formatBytes, formatNumber } from "../../../shared/format.ts";
import {
  EDITABLE_TEXTURE_SLOTS,
  TIER_BUDGET_LIMITS,
  TIER_IDS,
  type TierBudget,
  type TierId,
} from "../../../shared/limits.ts";
import { TierBudgets } from "../../../shared/settings.ts";

export type EditableSlot = (typeof EDITABLE_TEXTURE_SLOTS)[number];
export type RangeText = Readonly<{ target: string; max: string }>;

export type TierForm = Readonly<{
  triangles: RangeText;
  materials: string;
  /** `null` = slot tidak dipakai ("Tidak ada"); atlas warna selalu ada. */
  textures: Readonly<{ baseColor: number } & Record<Exclude<EditableSlot, "baseColor">, number | null>>;
  webBytes: RangeText;
}>;

export type BudgetForm = Readonly<Record<TierId, TierForm>>;

/** Kunci isian teks, mis. `sedang.triangles.target` atau `ringan.materials`. */
export type TextFieldKey =
  | `${TierId}.${"triangles" | "webBytes"}.${"target" | "max"}`
  | `${TierId}.materials`;

const KB = 1000;
const MB = 1000 * KB;
/** Atlas warna bawaan pipeline bila snapshot lama tidak menyebutnya (sama dengan `bakeSizes`). */
const BASE_COLOR_FALLBACK = 512;

function tierForm(budget: TierBudget): TierForm {
  return {
    triangles: {
      target: formatNumber(budget.triangles.target),
      max: formatNumber(budget.triangles.max),
    },
    materials: formatNumber(budget.materials),
    textures: {
      baseColor: budget.textures.baseColor ?? BASE_COLOR_FALLBACK,
      normal: budget.textures.normal ?? null,
      orm: budget.textures.orm ?? null,
      emissive: budget.textures.emissive ?? null,
    },
    webBytes: { target: formatBytes(budget.webBytes.target), max: formatBytes(budget.webBytes.max) },
  };
}

export function budgetForm(tiers: TierBudgets): BudgetForm {
  return {
    ringan: tierForm(tiers.ringan),
    sedang: tierForm(tiers.sedang),
    maksimal: tierForm(tiers.maksimal),
  };
}

/** Bilangan bulat dengan atau tanpa pemisah ribuan: "8.000", "8000", "8 000". */
export function parseCount(text: string): number | null {
  const compact = text.replace(/[\s.]/g, "");
  return /^\d{1,9}$/.test(compact) ? Number(compact) : null;
}

/**
 * Ukuran dalam KB/MB desimal (1 KB = 1000 byte, sama dengan `formatBytes`): "150 KB", "1,5 MB", "1.5 mb". Titik
 * diikuti tepat tiga angka adalah pemisah ribuan ("1.500 KB"); koma selalu desimal.
 */
export function parseSize(text: string): number | null {
  const match = /^(\d+(?:[.,]\d+)*)\s*(kb|mb)$/i.exec(text.trim());
  if (match === null) return null;
  const [, digits = "", unit = ""] = match;
  const normalized = digits.replace(/\.(?=\d{3}(?!\d))/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const bytes = Math.round(Number(normalized) * (unit.toLowerCase() === "mb" ? MB : KB));
  return Number.isSafeInteger(bytes) ? bytes : null;
}

type Limits = Readonly<{ min: number; max: number }>;
type FieldResult = { value: number } | { error: string };

function bounded(value: number | null, limits: Limits, format: (n: number) => string, invalid: string) {
  const { errors } = t.settings.assets;
  if (value === null) return { error: invalid };
  if (value < limits.min) return { error: errors.min(format(limits.min)) };
  if (value > limits.max) return { error: errors.max(format(limits.max)) };
  return { value };
}

function count(text: string, limits: Limits): FieldResult {
  return bounded(parseCount(text), limits, formatNumber, t.settings.assets.errors.number);
}

function size(text: string, limits: Limits): FieldResult {
  return bounded(parseSize(text), limits, formatBytes, t.settings.assets.errors.size);
}

export type BudgetValidation = Readonly<{
  /** Pesan per isian yang salah; kosong = semua benar. */
  errors: ReadonlyMap<TextFieldKey, string>;
  /** Budget siap dikirim; `null` selama ada error. */
  tiers: TierBudgets | null;
}>;

type Collector = Map<TextFieldKey, string>;

function range(
  errors: Collector,
  keys: Readonly<{ target: TextFieldKey; max: TextFieldKey }>,
  target: FieldResult,
  max: FieldResult,
) {
  if ("error" in target) errors.set(keys.target, target.error);
  if ("error" in max) errors.set(keys.max, max.error);
  if ("error" in target || "error" in max) return null;
  if (target.value > max.value) {
    errors.set(keys.target, t.settings.assets.errors.order);
    return null;
  }
  return { target: target.value, max: max.value };
}

function tierBudget(errors: Collector, tier: TierId, form: TierForm): TierBudget | null {
  const triangles = range(
    errors,
    { target: `${tier}.triangles.target`, max: `${tier}.triangles.max` },
    count(form.triangles.target, TIER_BUDGET_LIMITS.triangles),
    count(form.triangles.max, TIER_BUDGET_LIMITS.triangles),
  );
  const materials = count(form.materials, TIER_BUDGET_LIMITS.materials);
  if ("error" in materials) errors.set(`${tier}.materials`, materials.error);
  const webBytes = range(
    errors,
    { target: `${tier}.webBytes.target`, max: `${tier}.webBytes.max` },
    size(form.webBytes.target, TIER_BUDGET_LIMITS.webBytes),
    size(form.webBytes.max, TIER_BUDGET_LIMITS.webBytes),
  );
  if (triangles === null || webBytes === null || "error" in materials) return null;
  const { baseColor, normal, orm, emissive } = form.textures;
  return {
    triangles,
    materials: materials.value,
    textures: {
      baseColor,
      ...(normal === null ? {} : { normal }),
      ...(orm === null ? {} : { orm }),
      ...(emissive === null ? {} : { emissive }),
    },
    webBytes,
  };
}

export function validateBudget(form: BudgetForm): BudgetValidation {
  const errors: Collector = new Map();
  const ringan = tierBudget(errors, "ringan", form.ringan);
  const sedang = tierBudget(errors, "sedang", form.sedang);
  const maksimal = tierBudget(errors, "maksimal", form.maksimal);
  if (ringan === null || sedang === null || maksimal === null) return { errors, tiers: null };
  // Skema yang sama dengan server: pengaman bila aturan di sini tertinggal dari `shared/settings.ts`.
  const parsed = TierBudgets.safeParse({ ringan, sedang, maksimal });
  return parsed.success ? { errors, tiers: parsed.data } : { errors, tiers: null };
}

/** Tampilan rapi sebuah isian setelah fokus pindah ("8000" → "8.000", "1.5 mb" → "1,5 MB"); isian salah dibiarkan. */
export function tidyField(key: TextFieldKey, text: string): string {
  if (key.includes(".webBytes.")) {
    const bytes = parseSize(text);
    return bytes === null ? text : formatBytes(bytes);
  }
  const value = parseCount(text);
  return value === null ? text : formatNumber(value);
}

export function readField(form: BudgetForm, key: TextFieldKey): string {
  const [tier, field, part] = splitKey(key);
  const tierValues = form[tier];
  if (field === "materials") return tierValues.materials;
  return tierValues[field][part ?? "target"];
}

export function writeField(form: BudgetForm, key: TextFieldKey, text: string): BudgetForm {
  const [tier, field, part] = splitKey(key);
  const current = form[tier];
  const next: TierForm =
    field === "materials"
      ? { ...current, materials: text }
      : { ...current, [field]: { ...current[field], [part ?? "target"]: text } };
  return { ...form, [tier]: next };
}

export function writeTexture(
  form: BudgetForm,
  tier: TierId,
  slot: EditableSlot,
  value: number | null,
): BudgetForm {
  const current = form[tier];
  if (slot === "baseColor" && value === null) return form;
  return { ...form, [tier]: { ...current, textures: { ...current.textures, [slot]: value } } };
}

type KeyParts = readonly [TierId, "triangles" | "webBytes" | "materials", "target" | "max" | undefined];

function splitKey(key: TextFieldKey): KeyParts {
  const [tier, field, part] = key.split(".");
  const tierId = TIER_IDS.find((candidate) => candidate === tier);
  if (tierId === undefined || (field !== "triangles" && field !== "webBytes" && field !== "materials"))
    throw new Error(`Kunci isian budget tidak dikenal: ${key}`);
  return [tierId, field, part === "target" || part === "max" ? part : undefined];
}

/**
 * Nilai pembanding untuk "ada perubahan": isian yang bisa dibaca dibandingkan sebagai angka ("8000" = "8.000"), yang
 * belum benar sebagai teks.
 */
export function budgetSignature(form: BudgetForm): string {
  const parts: Array<string | number | null> = [];
  for (const tier of TIER_IDS) {
    const values = form[tier];
    const counted = (text: string) => parseCount(text) ?? text;
    const sized = (text: string) => parseSize(text) ?? text;
    parts.push(
      counted(values.triangles.target),
      counted(values.triangles.max),
      counted(values.materials),
      sized(values.webBytes.target),
      sized(values.webBytes.max),
      ...EDITABLE_TEXTURE_SLOTS.map((slot) => values.textures[slot]),
    );
  }
  return JSON.stringify(parts);
}
