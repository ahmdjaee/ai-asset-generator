import { hc } from "hono/client";
import type { AppType } from "../../server/app.ts";

/**
 * Client API bertipe dari `AppType` server, jadi rute dan bentuk respons dicek compiler.
 * Di mode dev, Vite meneruskan `/api` (HTTP dan WebSocket) ke server di port 4340.
 */
export const api = hc<AppType>(window.location.origin).api;

/** Respons gagal dari server. `code` stabil dan bisa dipakai UI; `message` sudah berbahasa Indonesia. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

function isErrorBody(value: unknown): value is { code: string; message: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    typeof value.code === "string" &&
    typeof value.message === "string"
  );
}

/** Mengubah respons gagal menjadi `ApiError`. Body selain `{ code, message }` diberi kode `HTTP_<status>`. */
export async function toApiError(response: { status: number; json(): Promise<unknown> }): Promise<ApiError> {
  const body = await response.json().catch(() => undefined);
  if (isErrorBody(body)) return new ApiError(body.code, body.message, response.status);
  return new ApiError(
    `HTTP_${response.status}`,
    `Server menjawab dengan status ${response.status}.`,
    response.status,
  );
}
