import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { z } from "zod";
import { formatBytes } from "../../shared/format.ts";
import { JSON_BODY_MAX_BYTES, UPLOAD_MAX_REQUEST_BYTES } from "../../shared/limits.ts";
import { AppError, errorBody } from "./errors.ts";

/** Nama field yang gagal divalidasi, untuk pesan error (tanpa nilai yang dikirim klien). */
function fieldsOf(issues: readonly z.core.$ZodIssue[], target: string): string {
  const fields = issues.map((issue) => (issue.path.length === 0 ? target : issue.path.map(String).join(".")));
  return [...new Set(fields)].join(", ");
}

/**
 * `zValidator` dengan kegagalan seragam: `{ code: "VALIDATION_FAILED", message }` status 400, lewat error handler
 * app (sama seperti error lain).
 */
export function validate<Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      throw new AppError(
        "VALIDATION_FAILED",
        `Isi permintaan tidak valid: ${fieldsOf(result.error.issues, target)}.`,
        400,
      );
    }
  });
}

function limit(maxSize: number) {
  return bodyLimit({
    maxSize,
    onError: (c) =>
      c.json(
        errorBody("PAYLOAD_TOO_LARGE", `Permintaan terlalu besar (maksimal ${formatBytes(maxSize)}).`),
        413,
      ),
  });
}

/** Unggahan multipart (pesan + lampiran). Bun `maxRequestBodySize` di `main.ts` sedikit di atas batas ini. */
export const uploadLimit = limit(UPLOAD_MAX_REQUEST_BYTES);

/** Body JSON kecil (jawaban, catatan, nama). */
export const jsonLimit = limit(JSON_BODY_MAX_BYTES);
