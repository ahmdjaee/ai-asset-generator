import { defineConfig, devices } from "@playwright/test";
import { E2E_PORT } from "./shared/ports.ts";

const baseURL = `http://127.0.0.1:${E2E_PORT}`;
const viewport = { width: 1440, height: 900 };

/**
 * Tes yang membuat aset. Server dan folder data dipakai bersama semua tes, jadi aset baru memunculkan toast "siap
 * direview" dan kartu "Terakhir dibuat" di halaman tes lain (mis. toast menutupi gizmo viewer). Tes ini berjalan di
 * project sendiri, satu per satu, setelah semua tes lain selesai.
 */
const ASSET_TESTS = /(gudang|states|studio)\.e2e\.ts$/;

const chromium = {
  ...devices["Desktop Chrome"],
  viewport,
  deviceScaleFactor: 1,
  // WebGL lewat SwiftShader (CPU), sama untuk semua mesin; tanpa GPU sungguhan.
  launchOptions: {
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  },
};

/**
 * E2E berjalan terhadap build mode test (memuat `/_smoke`) yang disajikan server Bun di port 4342, dengan folder
 * data sementara yang dikosongkan tiap kali dijalankan. Data pemilik di `data/` tidak tersentuh.
 */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.e2e.ts",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 2,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", testIgnore: ASSET_TESTS, use: chromium },
    { name: "aset", testMatch: ASSET_TESTS, dependencies: ["chromium"], workers: 1, use: chromium },
  ],
  webServer: {
    // Folder data dikosongkan dan diberi pustaka material uji (tahap tekstur skenario palsu, seperti `e2e:api`).
    command: "bun scripts/e2e-data.ts .tmp/e2e/data && bun run build:test && bun server/main.ts",
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(E2E_PORT),
      DATA_DIR: ".tmp/e2e/data",
      DIST_DIR: "dist-test",
      NODE_ENV: "test",
      LOG_LEVEL: "warn",
      // Tes rutin tanpa kuota dan tanpa Docker (AGENTS.md §10).
      AGENT_DRIVER: "fake",
      RUNTIME_DRIVER: "fixture",
    },
  },
});
