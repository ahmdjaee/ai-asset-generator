import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Logger } from "../log.ts";
import { ServiceError, type ServiceErrorCode } from "../services/errors.ts";

/** Kode error stabil untuk klien. Pesannya selalu berbahasa Indonesia. */
export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_FAILED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "PAYLOAD_TOO_LARGE"
  | "INTERNAL"
  | ServiceErrorCode;

export type ErrorBody = { code: ErrorCode; message: string };

export function errorBody(code: ErrorCode, message: string): ErrorBody {
  return { code, message };
}

/** Error yang sengaja dikirim ke klien. Error lain dianggap bug: dicatat ke log, klien hanya menerima INTERNAL. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: ContentfulStatusCode;

  constructor(code: ErrorCode, message: string, status: ContentfulStatusCode) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Status HTTP per kode error service. Ditulis lengkap (bukan `default`), supaya kode baru wajib diputuskan di sini.
 * 409 = aksi sah tetapi tidak berlaku pada status aset sekarang (gerbang `transition()`).
 */
export const SERVICE_STATUS: Readonly<Record<ServiceErrorCode, ContentfulStatusCode>> = {
  ASSET_NOT_FOUND: 404,
  QUESTION_NOT_FOUND: 404,
  VERSION_NOT_FOUND: 404,
  FILE_NOT_FOUND: 404,
  EMPTY_MESSAGE: 400,
  MESSAGE_TOO_LONG: 400,
  INVALID_ANSWER: 400,
  INVALID_NAME: 400,
  TOO_MANY_FILES: 400,
  INVALID_FILE: 400,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_FILE: 415,
  IN_REVIEW: 409,
  BASE_LOCKED: 409,
  BRIEF_REQUIRED: 409,
  BASE_NOT_APPROVED: 409,
  BUILD_CAP_REACHED: 409,
  WRONG_STAGE: 409,
  ASSET_DONE: 409,
  NOT_IN_REVIEW: 409,
  NO_VERSION: 409,
  QUESTION_OPEN: 409,
  NOT_FAILED: 409,
  NOT_INTERRUPTED: 409,
  SHAPE_CHANGE_NOT_ALLOWED: 409,
  EXPORT_FAILED: 500,
};

export function createErrorHandler(log: Logger) {
  return (error: Error, c: Context): Response => {
    if (error instanceof AppError) {
      return c.json(errorBody(error.code, error.message), error.status);
    }
    if (error instanceof ServiceError) {
      return c.json(errorBody(error.code, error.message), SERVICE_STATUS[error.code]);
    }
    if (error instanceof HTTPException) {
      const code: ErrorCode = error.status === 404 ? "NOT_FOUND" : "BAD_REQUEST";
      return c.json(errorBody(code, "Permintaan tidak bisa diproses."), error.status);
    }
    log.error({ err: error, method: c.req.method, path: c.req.path }, "error tak tertangani");
    return c.json(errorBody("INTERNAL", "Terjadi kesalahan di server. Detailnya ada di log server."), 500);
  };
}
