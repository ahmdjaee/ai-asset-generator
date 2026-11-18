/**
 * `bun run doctor` (PLAN Tahap 12): cek kesiapan mesin sebelum menjalankan app. Tidak memanggil model (tanpa kuota),
 * tidak mengubah apa pun. Email dan paket akun tidak dicetak (identitas akun disembunyikan, Log keputusan 2026-11-18).
 * Keluar dengan kode 1 bila ada pemeriksaan yang gagal; peringatan tidak menggagalkan.
 */
import { constants } from "node:fs";
import { access, lstat, statfs } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
  DOCTOR_CHECK_TIMEOUT_MS,
  DOCTOR_DISK_MIN_BYTES,
  DOCTOR_DISK_WARN_BYTES,
  DOCTOR_MIN_BUN,
} from "../shared/limits.ts";
import { API_PORT, WEB_DEV_PORT } from "../shared/ports.ts";

export type CheckStatus = "ok" | "warn" | "fail" | "skip";

export type Check = Readonly<{
  label: string;
  status: CheckStatus;
  detail: string;
  /** Langkah perbaikan bila tidak ok. */
  hint?: string;
}>;

/** Akun dari `accountInfo()`; hanya yang dibutuhkan untuk menilai login. */
export type AccountSummary = Readonly<{ loggedIn: boolean; apiKeySource: string | null }>;

export type PortState = "free" | "app" | "other";

export type DataDirState =
  | { kind: "missing"; parentWritable: boolean }
  | { kind: "present"; isDir: boolean; ownedByUser: boolean; writable: boolean };

export type DoctorDeps = Readonly<{
  bunVersion: string;
  which: (command: string) => string | null;
  account: () => Promise<AccountSummary>;
  dockerVersion: () => Promise<string | null>;
  imageTag: () => Promise<string>;
  imageExists: (tag: string) => Promise<boolean>;
  chromiumPresent: () => Promise<boolean>;
  dataDir: string;
  dataDirState: () => Promise<DataDirState>;
  freeBytes: () => Promise<number>;
  port: (port: number) => Promise<PortState>;
}>;

const GIB = 1024 * 1024 * 1024;
const gib = (bytes: number) => `${(bytes / GIB).toFixed(1).replace(".", ",")} GB`;

function failed(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Satu pemeriksaan tidak boleh menggantung doctor: batas waktu per pemeriksaan. */
async function withTimeout<T>(run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("tidak menjawab")), DOCTOR_CHECK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([run(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function checkBun(deps: DoctorDeps): Check {
  const ok = Bun.semver.satisfies(deps.bunVersion, `>=${DOCTOR_MIN_BUN}`);
  return ok
    ? { label: "Bun", status: "ok", detail: deps.bunVersion }
    : {
        label: "Bun",
        status: "fail",
        detail: `${deps.bunVersion}, butuh ≥ ${DOCTOR_MIN_BUN}`,
        hint: "Perbarui Bun: `bun upgrade`.",
      };
}

async function checkClaude(deps: DoctorDeps): Promise<Check[]> {
  const cli = deps.which("claude");
  if (cli === null) {
    return [
      {
        label: "CLI Claude Code",
        status: "fail",
        detail: "`claude` tidak ada di PATH",
        hint: "Pasang Claude Code, dan pastikan ~/.local/bin ada di PATH (juga di unit systemd).",
      },
      { label: "Login Claude", status: "skip", detail: "dilewati: CLI tidak ditemukan" },
    ];
  }
  const cliCheck: Check = { label: "CLI Claude Code", status: "ok", detail: cli };
  try {
    const account = await withTimeout(deps.account);
    if (account.apiKeySource !== null && account.apiKeySource !== "none") {
      return [
        cliCheck,
        {
          label: "Login Claude",
          status: "fail",
          detail: `memakai API key (${account.apiKeySource})`,
          hint: "App ini hanya memakai sesi login Claude Code: hapus API key, lalu login lewat `claude` → `/login`.",
        },
      ];
    }
    return [
      cliCheck,
      account.loggedIn
        ? { label: "Login Claude", status: "ok", detail: "login lewat Claude Code" }
        : {
            label: "Login Claude",
            status: "fail",
            detail: "belum login",
            hint: "Jalankan `claude` di terminal, lalu ketik `/login`.",
          },
    ];
  } catch (error) {
    return [
      cliCheck,
      {
        label: "Login Claude",
        status: "fail",
        detail: `gagal membaca sesi: ${failed(error)}`,
        hint: "Jalankan `claude` lalu `/login`, kemudian jalankan doctor lagi.",
      },
    ];
  }
}

async function checkDocker(deps: DoctorDeps): Promise<Check[]> {
  const version = await withTimeout(deps.dockerVersion).catch(() => null);
  if (version === null) {
    return [
      {
        label: "Docker",
        status: "fail",
        detail: "daemon tidak bisa dihubungi",
        hint: "Nyalakan Docker (`sudo systemctl start docker`) dan pastikan user ada di grup `docker`.",
      },
      { label: "Image runtime 3D", status: "skip", detail: "dilewati: Docker tidak tersedia" },
    ];
  }
  const tag = await deps.imageTag();
  const present = await withTimeout(() => deps.imageExists(tag)).catch(() => false);
  return [
    { label: "Docker", status: "ok", detail: version },
    present
      ? { label: "Image runtime 3D", status: "ok", detail: tag }
      : {
          label: "Image runtime 3D",
          status: "fail",
          detail: `${tag} belum ada`,
          hint: "Bangun image: `bun run runtime:build` (atau tombol Bangun image di Pengaturan).",
        },
  ];
}

async function checkChromium(deps: DoctorDeps): Promise<Check> {
  return (await deps.chromiumPresent().catch(() => false))
    ? { label: "Chromium renderer", status: "ok", detail: "terpasang (Playwright)" }
    : {
        label: "Chromium renderer",
        status: "fail",
        detail: "browser Playwright belum terpasang",
        hint: "Pasang: `bunx playwright install chromium`.",
      };
}

async function checkDisk(deps: DoctorDeps): Promise<Check> {
  try {
    const free = await deps.freeBytes();
    if (free < DOCTOR_DISK_MIN_BYTES) {
      return {
        label: "Ruang disk",
        status: "fail",
        detail: `${gib(free)} kosong`,
        hint: `Kosongkan disk; minimal ${gib(DOCTOR_DISK_MIN_BYTES)} untuk job Blender, versi, dan backup.`,
      };
    }
    if (free < DOCTOR_DISK_WARN_BYTES) {
      return {
        label: "Ruang disk",
        status: "warn",
        detail: `${gib(free)} kosong`,
        hint: `Disarankan ≥ ${gib(DOCTOR_DISK_WARN_BYTES)}.`,
      };
    }
    return { label: "Ruang disk", status: "ok", detail: `${gib(free)} kosong` };
  } catch (error) {
    return { label: "Ruang disk", status: "warn", detail: `tidak bisa dibaca: ${failed(error)}` };
  }
}

async function checkPort(deps: DoctorDeps, port: number, purpose: string, required: boolean): Promise<Check> {
  const label = `Port ${port} (${purpose})`;
  const state = await withTimeout(() => deps.port(port)).catch((): PortState => "other");
  if (state === "free") return { label, status: "ok", detail: "bebas" };
  if (state === "app") return { label, status: "ok", detail: "dipakai app ini (sedang berjalan)" };
  return {
    label,
    status: required ? "fail" : "warn",
    detail: "dipakai proses lain",
    hint: `Cari prosesnya: \`ss -ltnp 'sport = :${port}'\`.`,
  };
}

async function checkDataDir(deps: DoctorDeps): Promise<Check> {
  const label = "Folder data";
  const state = await deps.dataDirState();
  if (state.kind === "missing") {
    return state.parentWritable
      ? { label, status: "ok", detail: `${deps.dataDir} belum ada, dibuat saat server start` }
      : {
          label,
          status: "fail",
          detail: `${deps.dataDir} belum ada dan folder induknya tidak bisa ditulis`,
          hint: "Periksa izin folder proyek.",
        };
  }
  if (!state.isDir) {
    return { label, status: "fail", detail: `${deps.dataDir} bukan folder`, hint: "Pindahkan file itu." };
  }
  if (!state.ownedByUser || !state.writable) {
    return {
      label,
      status: "fail",
      detail: `${deps.dataDir} ${state.ownedByUser ? "tidak bisa ditulis" : "bukan milik user ini"}`,
      hint: `Kembalikan pemiliknya: \`sudo chown -R "$USER" ${deps.dataDir}\`.`,
    };
  }
  return { label, status: "ok", detail: `${deps.dataDir} bisa ditulis` };
}

export async function runDoctor(deps: DoctorDeps): Promise<Check[]> {
  const [claude, docker, chromium, disk, api, web, data] = await Promise.all([
    checkClaude(deps),
    checkDocker(deps),
    checkChromium(deps),
    checkDisk(deps),
    checkPort(deps, API_PORT, "server", true),
    checkPort(deps, WEB_DEV_PORT, "Vite dev", false),
    checkDataDir(deps),
  ]);
  return [checkBun(deps), ...claude, ...docker, chromium, disk, api, web, data];
}

const MARK: Record<CheckStatus, string> = { ok: "✓", warn: "!", fail: "✗", skip: "–" };

export function formatReport(checks: readonly Check[]): string {
  const width = Math.max(...checks.map((check) => check.label.length));
  const lines = checks.flatMap((check) => [
    `${MARK[check.status]} ${check.label.padEnd(width)}  ${check.detail}`,
    ...(check.hint === undefined || check.status === "ok" ? [] : [`  ${" ".repeat(width)}  → ${check.hint}`]),
  ]);
  const fails = checks.filter((check) => check.status === "fail").length;
  const warns = checks.filter((check) => check.status === "warn").length;
  const summary =
    fails > 0
      ? `${fails} pemeriksaan gagal${warns > 0 ? `, ${warns} peringatan` : ""}.`
      : `Mesin siap${warns > 0 ? ` (${warns} peringatan)` : ""}.`;
  return [...lines, "", summary].join("\n");
}

const HealthBody = z.object({ ok: z.literal(true), version: z.string() });

/** Port bebas, dipakai server app ini (`/api/health` menjawab), atau dipakai proses lain. */
async function probePort(port: number): Promise<PortState> {
  try {
    const probe = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response() });
    await probe.stop(true);
    return "free";
  } catch {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(DOCTOR_CHECK_TIMEOUT_MS),
    }).catch(() => null);
    const body: unknown = response?.ok === true ? await response.json().catch(() => null) : null;
    return HealthBody.safeParse(body).success ? "app" : "other";
  }
}

async function dataDirState(dir: string): Promise<DataDirState> {
  const writable = (path: string) =>
    access(path, constants.W_OK).then(
      () => true,
      () => false,
    );
  const info = await lstat(dir).catch(() => null);
  if (info === null) return { kind: "missing", parentWritable: await writable(dirname(dir)) };
  return {
    kind: "present",
    isDir: info.isDirectory(),
    ownedByUser: info.uid === process.getuid?.(),
    writable: await writable(dir),
  };
}

async function realDeps(): Promise<DoctorDeps> {
  // Modul server dimuat di sini, bukan di atas: tes memakai deps palsu tanpa memuat Docker/SDK/Playwright.
  const { loadConfig } = await import("../server/config.ts");
  const { readAccountInfo } = await import("../server/agent/sdk-adapter.ts");
  const { dockerServerVersion, imageExists } = await import("../server/runtime/docker.ts");
  const { runtimeImageTag } = await import("../server/runtime/image.ts");
  const { chromium } = await import("playwright");
  const { dataDir } = loadConfig();
  return {
    bunVersion: Bun.version,
    which: (command) => Bun.which(command),
    account: async () => {
      const info = await readAccountInfo();
      return { loggedIn: Boolean(info.email), apiKeySource: info.apiKeySource ?? null };
    },
    dockerVersion: dockerServerVersion,
    imageTag: () => runtimeImageTag(),
    imageExists,
    chromiumPresent: () => Bun.file(chromium.executablePath()).exists(),
    dataDir,
    dataDirState: () => dataDirState(dataDir),
    // Folder data mungkin belum ada: ukur disk folder induknya.
    freeBytes: async () => {
      const target = (await lstat(dataDir).catch(() => null)) === null ? dirname(dataDir) : dataDir;
      const stats = await statfs(target);
      return stats.bavail * stats.bsize;
    },
    port: probePort,
  };
}

if (import.meta.main) {
  console.log("Memeriksa kesiapan mesin…\n");
  const checks = await runDoctor(await realDeps());
  console.log(formatReport(checks));
  process.exit(checks.some((check) => check.status === "fail") ? 1 : 0);
}
