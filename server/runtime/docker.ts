/**
 * Satu-satunya pintu ke Docker (AGENTS.md §3, §7). Semua job Blender dijalankan lewat `runJob`.
 * - CLI `docker` dipanggil dengan `Bun.spawn` dan argumen array, tanpa shell.
 * - Flag sandbox dibangun oleh `buildRunArgs` (fungsi murni, dijaga tes snapshot).
 * - Output container tidak dipercaya: baris protokol divalidasi zod dan panjangnya dibatasi.
 */
import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import {
  DOCKER_CLI_TIMEOUT_MS,
  IMAGE_BUILD_TIMEOUT_MS,
  JOB_OUTPUT_TAIL_BYTES,
  type JobLimits,
} from "../../shared/limits.ts";

/** Label yang dipasang di setiap container job; dipakai untuk membersihkan container yatim. */
export const JOB_LABEL = "aag.job";
/**
 * Pemilik job: server dengan `DATA_DIR` tertentu (lihat `ownerForDataDir`), skrip, atau tes. Pembersihan container
 * yatim hanya menyentuh pemilik yang sama, supaya server dev dan server E2E tidak saling menghapus job.
 */
export const OWNER_LABEL = "aag.owner";
const OWNER_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** Awalan baris protokol yang dicetak `assetkit` ke stdout. */
export const PROTOCOL_PREFIX = "@@aag ";

const JOB_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** Baris protokol yang lebih panjang dari ini diabaikan (output container tidak dipercaya). */
const MAX_PROTOCOL_LINE = 4096;
/** Event progres yang disimpan per job; sisanya dibuang supaya memori tetap kecil. */
const MAX_PROGRESS_EVENTS = 500;
/** Jeda antar percobaan `docker kill` saat container belum sempat dibuat. */
const KILL_RETRY_MS = 250;

export class RuntimeError extends Error {
  readonly code: "INVALID_JOB" | "DOCKER_UNAVAILABLE" | "DOCKER_FAILED";

  constructor(code: RuntimeError["code"], message: string) {
    super(message);
    this.name = "RuntimeError";
    this.code = code;
  }
}

export type JobMounts = Readonly<{
  /** Folder kerja job, dipasang rw di `/job`. */
  jobDir: string;
  /** Lampiran referensi, dipasang ro di `/refs`. */
  refsDir?: string;
  /** Paket Python `assetkit`, dipasang ro di `/opt/assetkit`. */
  assetkitDir: string;
  /** Pustaka material CC0 (`data/library/materials`), dipasang ro di `/materials`. Hanya job bertekstur. */
  materialsDir?: string;
}>;

export type RunSpec = Readonly<{
  jobId: string;
  image: string;
  mounts: JobMounts;
  limits: JobLimits;
  /** `uid:gid` proses di container. Bawaan: user yang menjalankan server, supaya file di `/job` miliknya. */
  user: string;
  /** Nilai label `aag.owner`. */
  owner: string;
  command: readonly string[];
}>;

/** Pemilik job untuk server dengan `DATA_DIR` ini: `d-` + 12 hex sha256 path absolutnya. */
export function ownerForDataDir(dataDir: string): string {
  return `d-${createHash("sha256").update(resolve(dataDir)).digest("hex").slice(0, 12)}`;
}

/** Lokasi pustaka material di container (env `AAG_MATERIALS`). */
export const MATERIALS_MOUNT = "/materials";

export const DEFAULT_COMMAND = ["python", "-m", "assetkit.run", "/job/script.py"] as const;

export function containerName(jobId: string): string {
  return `aag-job-${jobId}`;
}

function assertMountPath(label: string, path: string): void {
  // `--mount` memakai koma sebagai pemisah, jadi path dengan koma bisa menyelipkan opsi lain.
  if (!isAbsolute(path) || path.includes(",") || path.includes("\n")) {
    throw new RuntimeError("INVALID_JOB", `Path ${label} tidak valid untuk mount: ${path}`);
  }
}

function bindMount(source: string, target: string, readOnly: boolean): string[] {
  const options = [`type=bind`, `source=${source}`, `target=${target}`];
  if (readOnly) options.push("readonly");
  return ["--mount", options.join(",")];
}

/** Argumen `docker run` untuk satu job. Murni: tanpa I/O, hasilnya dijaga tes snapshot. */
export function buildRunArgs(spec: RunSpec): string[] {
  if (!JOB_ID_PATTERN.test(spec.jobId)) {
    throw new RuntimeError("INVALID_JOB", `jobId tidak valid: ${spec.jobId}`);
  }
  if (!OWNER_PATTERN.test(spec.owner)) {
    throw new RuntimeError("INVALID_JOB", `owner tidak valid: ${spec.owner}`);
  }
  if (!/^\d+:\d+$/.test(spec.user)) {
    throw new RuntimeError("INVALID_JOB", `user harus berbentuk uid:gid, bukan ${spec.user}`);
  }
  assertMountPath("jobDir", spec.mounts.jobDir);
  assertMountPath("assetkitDir", spec.mounts.assetkitDir);
  if (spec.mounts.refsDir !== undefined) assertMountPath("refsDir", spec.mounts.refsDir);
  if (spec.mounts.materialsDir !== undefined) assertMountPath("materialsDir", spec.mounts.materialsDir);

  const { limits } = spec;
  const threads = Math.max(1, Math.floor(limits.cpus));
  return [
    "run",
    "--name",
    containerName(spec.jobId),
    "--label",
    `${JOB_LABEL}=${spec.jobId}`,
    "--label",
    `${OWNER_LABEL}=${spec.owner}`,
    "--init",
    // Image hanya dari `runtime:build` lokal: image yang belum ada gagal jelas, tidak ditarik dari registry.
    "--pull",
    "never",
    "--network",
    "none",
    "--read-only",
    "--tmpfs",
    `/tmp:rw,nosuid,nodev,size=${limits.tmpfsBytes}`,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    String(limits.pids),
    "--memory",
    String(limits.memoryBytes),
    "--memory-swap",
    String(limits.memoryBytes),
    "--cpus",
    String(limits.cpus),
    "--user",
    spec.user,
    "--env",
    "HOME=/tmp",
    "--env",
    `AAG_THREADS=${threads}`,
    "--env",
    `AAG_JOB_ID=${spec.jobId}`,
    "--env",
    "PYTHONPATH=/opt/assetkit",
    "--env",
    "PYTHONDONTWRITEBYTECODE=1",
    ...(spec.mounts.materialsDir === undefined ? [] : ["--env", `AAG_MATERIALS=${MATERIALS_MOUNT}`]),
    "--workdir",
    "/job",
    ...bindMount(spec.mounts.jobDir, "/job", false),
    ...(spec.mounts.refsDir === undefined ? [] : bindMount(spec.mounts.refsDir, "/refs", true)),
    ...bindMount(spec.mounts.assetkitDir, "/opt/assetkit", true),
    ...(spec.mounts.materialsDir === undefined
      ? []
      : bindMount(spec.mounts.materialsDir, MATERIALS_MOUNT, true)),
    spec.image,
    ...spec.command,
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Protokol stdout `assetkit`

const ProgressEvent = z.object({
  type: z.literal("progress"),
  step: z.string().min(1).max(200),
  pct: z.number().min(0).max(100),
});
const MemoryEvent = z.object({ type: z.literal("memory"), peakBytes: z.number().int().nonnegative() });
const ProtocolEvent = z.discriminatedUnion("type", [ProgressEvent, MemoryEvent]);

export type ProgressEvent = z.infer<typeof ProgressEvent>;
export type ProtocolEvent = z.infer<typeof ProtocolEvent>;

/** Baris `@@aag {...}` → event. Baris lain, JSON rusak, atau bentuk tak dikenal → `null`. */
export function parseProtocolLine(line: string): ProtocolEvent | null {
  if (!line.startsWith(PROTOCOL_PREFIX) || line.length > MAX_PROTOCOL_LINE) return null;
  let json: unknown;
  try {
    json = JSON.parse(line.slice(PROTOCOL_PREFIX.length));
  } catch {
    return null;
  }
  const parsed = ProtocolEvent.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** Menyimpan hanya `limit` byte terakhir dari teks yang terus ditambahkan. */
export class TailBuffer {
  private text = "";
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  append(chunk: string): void {
    this.text += chunk;
    if (this.text.length > this.limit * 2) this.text = this.text.slice(-this.limit);
  }

  toString(): string {
    return this.text.length > this.limit ? this.text.slice(-this.limit) : this.text;
  }
}

/** Membaca stream baris per baris. Baris terakhir tanpa newline tetap diproses. */
async function forEachLine(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of stream) {
    pending += decoder.decode(chunk, { stream: true });
    let newline = pending.indexOf("\n");
    while (newline !== -1) {
      onLine(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
    }
  }
  pending += decoder.decode();
  if (pending !== "") onLine(pending);
}

// ---------------------------------------------------------------------------------------------------------------
// Pemanggilan CLI docker

export type CliResult = { exitCode: number; stdout: string; stderr: string };

/** Perintah docker pendek dengan batas waktu. Gagal menjalankan `docker` sama sekali → `DOCKER_UNAVAILABLE`. */
export async function dockerCli(
  args: readonly string[],
  timeoutMs = DOCKER_CLI_TIMEOUT_MS,
): Promise<CliResult> {
  let proc: ReturnType<typeof Bun.spawn<"ignore", "pipe", "pipe">>;
  try {
    proc = Bun.spawn(["docker", ...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
  } catch (error) {
    throw new RuntimeError("DOCKER_UNAVAILABLE", `CLI docker tidak bisa dijalankan: ${String(error)}`);
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

const ContainerState = z.object({ ExitCode: z.number().int(), OOMKilled: z.boolean() });

async function inspectState(name: string): Promise<z.infer<typeof ContainerState> | null> {
  const result = await dockerCli(["inspect", "--format", "{{json .State}}", name]);
  if (result.exitCode !== 0) return null;
  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    return null;
  }
  const parsed = ContainerState.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** `true` bila image dengan tag itu sudah ada di mesin. */
export async function imageExists(tag: string): Promise<boolean> {
  const result = await dockerCli(["image", "inspect", "--format", "{{.Id}}", tag]);
  return result.exitCode === 0;
}

/** Versi Docker Engine, atau `null` bila daemon tidak terjangkau (CLI tidak ada, daemon mati, tanpa izin). */
export async function dockerServerVersion(): Promise<string | null> {
  const result = await dockerCli(["version", "--format", "{{.Server.Version}}"]).catch(() => null);
  if (result === null || result.exitCode !== 0) return null;
  const version = result.stdout.trim();
  return /^[0-9][0-9A-Za-z.+-]{0,40}$/.test(version) ? version : null;
}

/** Baris terakhir output build yang dibawa error (bukan seluruh log). */
const BUILD_TAIL_BYTES = 2000;

export type BuildImageOptions = Readonly<{
  signal?: AbortSignal;
  /** `inherit` (bawaan, skrip CLI): output ke terminal. `capture`: ekornya disimpan untuk pesan error di app. */
  output?: "inherit" | "capture";
}>;

/** `docker build`. Gagal → `DOCKER_FAILED` dengan ekor output (mode `capture`). */
export async function buildImage(
  contextDir: string,
  tag: string,
  options: BuildImageOptions = {},
): Promise<void> {
  assertMountPath("contextDir", contextDir);
  const capture = options.output === "capture";
  const proc = Bun.spawn(["docker", "build", "--tag", tag, contextDir], {
    stdio: ["ignore", capture ? "pipe" : "inherit", capture ? "pipe" : "inherit"],
    timeout: IMAGE_BUILD_TIMEOUT_MS,
    killSignal: "SIGTERM",
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  const tail = new TailBuffer(BUILD_TAIL_BYTES);
  const readers =
    proc.stdout instanceof ReadableStream && proc.stderr instanceof ReadableStream
      ? [proc.stdout, proc.stderr].map((stream) => forEachLine(stream, (line) => tail.append(`${line}\n`)))
      : [];
  const [exitCode] = await Promise.all([proc.exited, ...readers]);
  if (exitCode !== 0) {
    const detail = tail.toString().trim();
    throw new RuntimeError(
      "DOCKER_FAILED",
      `docker build gagal (kode ${exitCode})${detail === "" ? "" : `:\n${detail}`}`,
    );
  }
}

/**
 * Menghapus container yatim milik `owner` (misalnya server mati di tengah job). Hasil: jumlah yang dihapus.
 * Filter label docker bersifat AND: hanya container job dengan pemilik yang sama.
 */
export async function removeOrphanJobs(owner: string): Promise<number> {
  if (!OWNER_PATTERN.test(owner)) throw new RuntimeError("INVALID_JOB", `owner tidak valid: ${owner}`);
  const listed = await dockerCli([
    "ps",
    "-aq",
    "--filter",
    `label=${JOB_LABEL}`,
    "--filter",
    `label=${OWNER_LABEL}=${owner}`,
  ]);
  if (listed.exitCode !== 0) {
    throw new RuntimeError("DOCKER_FAILED", `docker ps gagal: ${listed.stderr.trim()}`);
  }
  const ids = listed.stdout.split("\n").filter((id) => id.trim() !== "");
  if (ids.length === 0) return 0;
  const removed = await dockerCli(["rm", "-f", ...ids]);
  if (removed.exitCode !== 0) {
    throw new RuntimeError("DOCKER_FAILED", `docker rm gagal: ${removed.stderr.trim()}`);
  }
  return ids.length;
}

// ---------------------------------------------------------------------------------------------------------------
// Menjalankan job

export type RunJobOptions = Readonly<{
  jobId: string;
  image: string;
  mounts: JobMounts;
  limits: JobLimits;
  /** Label `aag.owner` (lihat `OWNER_LABEL`). */
  owner: string;
  command?: readonly string[];
  user?: string;
  signal?: AbortSignal;
  /** Dipanggil untuk setiap event progres yang valid (diteruskan ke WebSocket di tahap berikutnya). */
  onProgress?: (event: ProgressEvent) => void;
}>;

export type JobResult = Readonly<{
  /** Kode keluar proses di container; `null` bila container tidak sempat dibuat. */
  exitCode: number | null;
  oom: boolean;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
  /** `memory.peak` cgroup yang dicetak wrapper `assetkit`; `null` bila job mati sebelum mencetaknya. */
  peakMemBytes: number | null;
  stdoutTail: string;
  stderrTail: string;
  progress: readonly ProgressEvent[];
}>;

function currentUser(): string {
  return `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;
}

/**
 * Menjalankan satu job sampai selesai, timeout, atau dibatalkan.
 * Container tidak memakai `--rm`: setelah keluar, `docker inspect` membaca `OOMKilled`, lalu container dihapus.
 */
export async function runJob(options: RunJobOptions): Promise<JobResult> {
  const name = containerName(options.jobId);
  const args = buildRunArgs({
    jobId: options.jobId,
    image: options.image,
    mounts: options.mounts,
    limits: options.limits,
    user: options.user ?? currentUser(),
    owner: options.owner,
    command: options.command ?? DEFAULT_COMMAND,
  });

  const startedAt = performance.now();
  let proc: ReturnType<typeof Bun.spawn<"ignore", "pipe", "pipe">>;
  try {
    proc = Bun.spawn(["docker", ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  } catch (error) {
    throw new RuntimeError("DOCKER_UNAVAILABLE", `CLI docker tidak bisa dijalankan: ${String(error)}`);
  }

  let timedOut = false;
  let cancelled = false;
  let exited = false;

  // Container bisa belum ada saat timeout/batal terjadi; ulangi `docker kill` sampai berhasil atau proses selesai.
  const killContainer = async (): Promise<void> => {
    while (!exited) {
      const result = await dockerCli(["kill", name]);
      if (result.exitCode === 0) return;
      await Bun.sleep(KILL_RETRY_MS);
    }
  };
  const stop = (reason: "timeout" | "cancel"): void => {
    if (timedOut || cancelled) return;
    if (reason === "timeout") timedOut = true;
    else cancelled = true;
    void killContainer().catch(() => undefined);
  };

  const timer = setTimeout(() => stop("timeout"), options.limits.timeoutMs);
  const onAbort = (): void => stop("cancel");
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) onAbort();

  const stdoutTail = new TailBuffer(JOB_OUTPUT_TAIL_BYTES);
  const stderrTail = new TailBuffer(JOB_OUTPUT_TAIL_BYTES);
  const progress: ProgressEvent[] = [];
  let peakMemBytes: number | null = null;

  try {
    await Promise.all([
      forEachLine(proc.stdout, (line) => {
        const event = parseProtocolLine(line);
        if (event === null) {
          stdoutTail.append(`${line}\n`);
        } else if (event.type === "progress") {
          if (progress.length < MAX_PROGRESS_EVENTS) progress.push(event);
          options.onProgress?.(event);
        } else {
          peakMemBytes = event.peakBytes;
        }
      }),
      forEachLine(proc.stderr, (line) => stderrTail.append(`${line}\n`)),
    ]);
    await proc.exited;
  } finally {
    exited = true;
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }

  const state = await inspectState(name);
  await dockerCli(["rm", "-f", name]);

  return {
    exitCode: state?.ExitCode ?? null,
    oom: state?.OOMKilled ?? false,
    timedOut,
    cancelled,
    durationMs: Math.round(performance.now() - startedAt),
    peakMemBytes,
    stdoutTail: stdoutTail.toString(),
    stderrTail: stderrTail.toString(),
    progress,
  };
}
