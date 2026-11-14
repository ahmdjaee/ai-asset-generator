import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_PORT, WEB_DEV_PORT } from "../shared/ports.ts";
import { openTestApi, type TestApi } from "../tests/support/api.ts";
import { createApp } from "./app.ts";
import { createLogger } from "./log.ts";
import { APP_VERSION } from "./version.ts";

const log = createLogger("silent");
const PORTS = [API_PORT, WEB_DEV_PORT] as const;
let api: TestApi;

beforeAll(async () => {
  api = await openTestApi();
});

afterAll(async () => {
  await api.close();
});

describe("API", () => {
  const app = () => api.app;

  test("GET /api/health mengembalikan versi", async () => {
    const res = await app().request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: APP_VERSION });
  });

  test("rute API yang tidak ada → 404 berformat { code, message }", async () => {
    const res = await app().request("/api/tidak-ada");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: "NOT_FOUND", message: "Alamat API tidak ditemukan." });
  });

  test("Host asing → 403 sebelum rute dijalankan", async () => {
    const res = await app().request("/api/health", { headers: { host: "evil.example" } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  test("Origin asing → 403", async () => {
    const res = await app().request("/api/health", { headers: { origin: "http://evil.example" } });
    expect(res.status).toBe(403);
  });

  test("tanpa distDir, server tidak menyajikan halaman web", async () => {
    const res = await app().request("/");
    expect(res.status).toBe(404);
  });
});

describe("menyajikan build web", () => {
  let distDir = "";

  beforeAll(async () => {
    distDir = await mkdtemp(join(tmpdir(), "aag-dist-"));
    await mkdir(join(distDir, "assets"));
    await writeFile(join(distDir, "index.html"), "<!doctype html><title>app</title>");
    await writeFile(join(distDir, "assets", "app-abc123.js"), "console.log(1)");
  });

  afterAll(async () => {
    await rm(distDir, { recursive: true, force: true });
  });

  test("halaman utama dan rute SPA dijawab index.html tanpa cache", async () => {
    const app = createApp({ log, allowedPorts: PORTS, distDir, api: api.services });
    for (const path of ["/", "/gudang", "/aset/123/detail"]) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("<title>app</title>");
      expect(res.headers.get("cache-control")).toBe("no-cache");
    }
  });

  test("file di /assets di-cache selamanya", async () => {
    const app = createApp({ log, allowedPorts: PORTS, distDir, api: api.services });
    const res = await app.request("/assets/app-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  test("file yang tidak ada → 404, bukan index.html", async () => {
    const app = createApp({ log, allowedPorts: PORTS, distDir, api: api.services });
    expect((await app.request("/assets/hilang.js")).status).toBe(404);
    expect((await app.request("/favicon.ico")).status).toBe(404);
  });

  test("path traversal tidak keluar dari distDir", async () => {
    const app = createApp({ log, allowedPorts: PORTS, distDir, api: api.services });
    const res = await app.request("/..%2f..%2fetc%2fpasswd");
    expect(await res.text()).not.toContain("root:");
  });
});
