import pino from "pino";
import type { LogLevel } from "./config.ts";

export type Logger = pino.Logger;

/**
 * Logger JSON terstruktur. Sertakan `assetId`/`jobId`/`sessionId` lewat `log.child({...})`.
 * Jangan pernah mencatat base64, gambar, isi env, token, atau isi skrip lengkap (AGENTS.md §5).
 */
export function createLogger(level: LogLevel): Logger {
  return pino({
    level,
    base: { app: "ai-asset-generate" },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ["*.env", "*.token", "*.apiKey", "*.password", "headers.authorization", "headers.cookie"],
      censor: "[disembunyikan]",
    },
  });
}
