import { serveStatic } from "@hono/bun";
import { Hono } from "hono";
import { createErrorHandler, errorBody } from "./http/errors.ts";
import { hostOriginGuard } from "./http/guard.ts";
import { type AssetRouteDeps, assetRoutes } from "./http/routes/assets.ts";
import { type HealthRouteDeps, healthRoutes } from "./http/routes/health.ts";
import { settingsRoutes } from "./http/routes/settings.ts";
import type { Logger } from "./log.ts";
import type { Hub } from "./realtime/hub.ts";
import { realtimeRoute } from "./realtime/route.ts";
import type { SettingsService } from "./services/settings.ts";

export type ApiDeps = AssetRouteDeps & HealthRouteDeps & Readonly<{ hub: Hub; settings: SettingsService }>;

export type AppDeps = {
  log: Logger;
  /** Port yang sah di header Origin: port API dan port Vite dev. */
  allowedPorts: readonly number[];
  /** Folder hasil `vite build`. Tanpa ini server hanya melayani /api (web dari Vite dev). */
  distDir?: string;
  /** Service yang dilayani API (dari `createServices`). */
  api: ApiDeps;
};

/** Rute API. Tipe dari rantai ini (`AppType`) dipakai client `hc` di web. */
function createApi(deps: ApiDeps) {
  return new Hono()
    .route("/health", healthRoutes(deps))
    .route("/assets", assetRoutes(deps))
    .route("/settings", settingsRoutes(deps.settings))
    .get("/ws", realtimeRoute(deps.hub));
}

export function createApp(deps: AppDeps) {
  const app = new Hono();
  app.use("*", hostOriginGuard(deps.allowedPorts));
  app.onError(createErrorHandler(deps.log));

  const routes = app.route("/api", createApi(deps.api));
  app.all("/api/*", (c) => c.json(errorBody("NOT_FOUND", "Alamat API tidak ditemukan."), 404));

  if (deps.distDir) mountWeb(app, deps.distDir);
  return routes;
}

export type AppType = ReturnType<typeof createApp>;

/** Menyajikan hasil build web. Path tanpa ekstensi (rute SPA) dijawab index.html. */
function mountWeb(app: Hono, distDir: string): void {
  app.use("*", async (c, next) => {
    await next();
    if (!c.res.ok) return;
    // Nama file di /assets memuat hash isi, jadi aman di-cache selamanya. HTML selalu dicek ulang.
    if (c.req.path.startsWith("/assets/")) {
      c.header("Cache-Control", "public, max-age=31536000, immutable");
    } else if (c.res.headers.get("content-type")?.startsWith("text/html")) {
      c.header("Cache-Control", "no-cache");
    }
  });
  app.use("*", serveStatic({ root: distDir }));
  app.get("*", (c, next) =>
    /\.[a-z0-9]+$/i.test(c.req.path) ? next() : serveStatic({ root: distDir, path: "index.html" })(c, next),
  );
  app.notFound((c) => c.text("Tidak ditemukan", 404));
}
