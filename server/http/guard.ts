import type { MiddlewareHandler } from "hono";
import { errorBody } from "./errors.ts";

/**
 * Pagar Host/Origin untuk semua rute, termasuk sebelum upgrade WebSocket. Diturunkan dari ai-team `server/http-guard.ts`.
 *
 * - Host asing = DNS rebinding: situs jahat yang namanya diarahkan ke 127.0.0.1.
 * - Origin asing = CSRF dari situs lain. WebSocket tidak dilindungi CORS, jadi Origin wajib dicek di handshake.
 * - Tanpa header Origin (curl, skrip lokal) tetap lolos: browser selalu mengirim Origin untuk POST/PUT/DELETE
 *   dan WebSocket.
 *
 * Alasan pagar ini wajib: user mesin ini anggota grup docker (setara root), jadi API yang bisa dijangkau situs
 * lain sama dengan memberi akses root.
 */

const LOOPBACK_NAMES = new Set(["127.0.0.1", "localhost", "::1"]);

/** "localhost:4340" → "localhost"; "[::1]:4340" → "::1". */
export function hostnameOf(host: string): string {
  const value = host.trim().toLowerCase();
  if (value.startsWith("[")) return value.slice(1, value.indexOf("]"));
  const colon = value.indexOf(":");
  return colon >= 0 ? value.slice(0, colon) : value;
}

export function allowedHost(host: string | undefined): boolean {
  // Tanpa Host (HTTP/1.0, alat lokal) bukan dari browser; DNS rebinding selalu membawa Host.
  if (host === undefined) return true;
  return LOOPBACK_NAMES.has(hostnameOf(host));
}

/** `ports`: port API dan port Vite dev. Origin hanya sah bila http, loopback, dan memakai salah satu port itu. */
export function allowedOrigin(origin: string | undefined, ports: ReadonlySet<string>): boolean {
  if (origin === undefined) return true;
  let url: URL;
  try {
    url = new URL(origin.trim().toLowerCase());
  } catch {
    // "null" (iframe sandbox, file://) dan nilai rusak lain
    return false;
  }
  if (url.protocol !== "http:") return false;
  const name = url.hostname.replace(/^\[|\]$/g, "");
  return LOOPBACK_NAMES.has(name) && ports.has(url.port);
}

/** Alasan penolakan (bahasa Indonesia), atau undefined bila lolos. */
export function rejectReason(
  headers: Headers,
  method: string,
  ports: ReadonlySet<string>,
): string | undefined {
  if (!allowedHost(headers.get("host") ?? undefined)) {
    return "Alamat host tidak dikenal. Buka app lewat http://127.0.0.1 atau http://localhost.";
  }
  if (!allowedOrigin(headers.get("origin") ?? undefined, ports)) {
    return "Permintaan dari situs lain ditolak.";
  }
  const site = headers.get("sec-fetch-site");
  if (method !== "GET" && method !== "HEAD" && site === "cross-site") {
    return "Permintaan lintas situs ditolak.";
  }
  return undefined;
}

export function hostOriginGuard(allowedPorts: readonly number[]): MiddlewareHandler {
  const ports = new Set(allowedPorts.map(String));
  return async (c, next) => {
    const reason = rejectReason(c.req.raw.headers, c.req.method, ports);
    if (reason) return c.json(errorBody("FORBIDDEN", reason), 403);
    await next();
    return undefined;
  };
}
