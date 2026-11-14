/**
 * `bun run dev`: server API (`bun --watch`) dan Vite berjalan bersama (port dari ai-team `scripts/dev.mjs`).
 * - Ctrl+C atau SIGTERM menghentikan keduanya.
 * - Port API dan Vite dicek dulu. `bun --watch` tidak keluar saat server gagal bind, jadi tanpa cek ini Vite tetap
 *   jalan dan meneruskan /api ke proses lain yang memakai port itu (terbukti di Tahap 0).
 * - Bila salah satu proses berhenti sendiri, yang lain ikut dihentikan.
 * Kedua proses memang berjalan sampai dihentikan, jadi tanpa timeout; saat berhenti ada batas waktu sebelum SIGKILL.
 */
import { join } from "node:path";
import type { Subprocess } from "bun";
import { loadConfig } from "../server/config.ts";
import { WEB_DEV_PORT } from "../shared/ports.ts";

const ROOT = join(import.meta.dir, "..");
const SHUTDOWN_GRACE_MS = 5_000;

type Child = { name: string; process: Subprocess };

function start(name: string, cmd: string[]): Child {
  return { name, process: Bun.spawn(cmd, { cwd: ROOT, stdio: ["inherit", "inherit", "inherit"] }) };
}

/** Keluar dengan pesan jelas bila port sudah dipakai proses lain. */
async function ensurePortFree(port: number, label: string): Promise<void> {
  let probe: ReturnType<typeof Bun.serve>;
  try {
    probe = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response(null, { status: 503 }) });
  } catch {
    console.error(
      `[dev] Port ${port} (${label}) sudah dipakai proses lain. Hentikan proses itu atau ubah PORT di .env.`,
    );
    process.exit(1);
  }
  await probe.stop(true);
}

// Port API dibaca lewat config server (PORT di .env bila diisi), sama dengan yang dipakai server dan Vite.
await ensurePortFree(loadConfig().port, "API");
await ensurePortFree(WEB_DEV_PORT, "Vite");

const children: Child[] = [
  start("server", [process.execPath, "--watch", "server/main.ts"]),
  // File entry Vite dijalankan langsung (bukan bin `vite`), supaya berhenti bersih tanpa pesan error dari wrapper bun.
  start("web", [process.execPath, "--bun", "node_modules/vite/bin/vite.js"]),
];

let stopping = false;

async function stopAll(exitCode: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.process.exitCode === null) child.process.kill("SIGTERM");
  }
  const forceKill = setTimeout(() => {
    for (const child of children) {
      if (child.process.exitCode === null) child.process.kill("SIGKILL");
    }
  }, SHUTDOWN_GRACE_MS);
  await Promise.all(children.map((child) => child.process.exited));
  clearTimeout(forceKill);
  process.exit(exitCode);
}

function logError(error: unknown): void {
  console.error("[dev] gagal menghentikan proses:", error);
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void stopAll(0).catch(logError);
  });
}

const first = await Promise.race(
  children.map(async (child) => ({ name: child.name, code: await child.process.exited })),
);
if (!stopping) {
  console.error(`[dev] ${first.name} berhenti (kode ${first.code}); proses lain ikut dihentikan.`);
  await stopAll(first.code === 0 ? 1 : first.code);
}
