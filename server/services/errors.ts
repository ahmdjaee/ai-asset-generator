/**
 * Error service dengan `code` stabil (AGENTS.md §4). Tahap 6 memetakannya ke respons HTTP `{ code, message }`.
 * Pesannya berbahasa Indonesia dan aman ditampilkan ke pemilik.
 */
import type { RejectCode } from "../domain/status.ts";

export type ServiceErrorCode =
  | RejectCode
  | "ASSET_NOT_FOUND"
  | "QUESTION_NOT_FOUND"
  | "INVALID_ANSWER"
  | "EMPTY_MESSAGE"
  | "MESSAGE_TOO_LONG"
  | "INVALID_NAME"
  | "TOO_MANY_FILES"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FILE"
  | "INVALID_FILE"
  | "VERSION_NOT_FOUND"
  | "FILE_NOT_FOUND"
  | "EXPORT_FAILED";

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;

  constructor(code: ServiceErrorCode, message: string) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
  }
}

export function assetNotFound(id: string): ServiceError {
  return new ServiceError("ASSET_NOT_FOUND", `Aset ${id} tidak ditemukan.`);
}
