import { Hono } from "hono";
import { APP_VERSION } from "../../version.ts";

/** Kesehatan server. Cek sesi Claude (`/auth`) dan runtime (`/runtime`) menyusul di Tahap 11. */
export const healthRoutes = new Hono().get("/", (c) => c.json({ ok: true as const, version: APP_VERSION }));
