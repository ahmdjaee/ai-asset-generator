/**
 * Validasi GLB dengan gltf-validator (Khronos). Dijalankan SEBELUM kompresi meshopt karena validator tidak bisa
 * membaca `EXT_meshopt_compression`. Laporan validator diperlakukan sebagai data luar → divalidasi zod.
 */
import { validateBytes } from "gltf-validator";
import { z } from "zod";

/** Jumlah pesan yang disimpan (pesan lengkap tidak perlu dikirim ke Claude). */
const MAX_MESSAGES = 10;

const Report = z.object({
  issues: z.object({
    numErrors: z.number().int().nonnegative(),
    numWarnings: z.number().int().nonnegative(),
    numInfos: z.number().int().nonnegative(),
    numHints: z.number().int().nonnegative(),
    messages: z.array(
      z.object({
        code: z.string(),
        message: z.string(),
        severity: z.number().int(),
        pointer: z.string().optional(),
      }),
    ),
  }),
});

export type ValidationMessage = Readonly<{
  code: string;
  message: string;
  severity: number;
  pointer?: string;
}>;

export type ValidationResult = Readonly<{
  ok: boolean;
  errors: number;
  warnings: number;
  infos: number;
  hints: number;
  /** Pesan pertama, error lebih dulu. */
  messages: readonly ValidationMessage[];
}>;

export async function validateGlb(bytes: Uint8Array): Promise<ValidationResult> {
  const raw: unknown = await validateBytes(bytes, { format: "glb", maxIssues: 100, writeTimestamp: false });
  const { issues } = Report.parse(raw);
  const messages = [...issues.messages].sort((a, b) => a.severity - b.severity).slice(0, MAX_MESSAGES);
  return {
    ok: issues.numErrors === 0,
    errors: issues.numErrors,
    warnings: issues.numWarnings,
    infos: issues.numInfos,
    hints: issues.numHints,
    messages,
  };
}
