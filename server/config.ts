import { join, resolve } from "node:path";
import { z } from "zod";
import { API_PORT } from "../shared/ports.ts";
import { APP_VERSION } from "./version.ts";

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const RUN_MODES = ["development", "production", "test"] as const;
export type RunMode = (typeof RUN_MODES)[number];

/** `sdk`: Claude sungguhan (kuota pemilik). `fake`: skenario deterministik untuk tes dan E2E. */
export const AGENT_DRIVERS = ["sdk", "fake"] as const;
export type AgentDriver = (typeof AGENT_DRIVERS)[number];

/** `docker`: Blender di sandbox + pipeline + Chromium. `fixture`: GLB dan contact sheet siap pakai. */
export const RUNTIME_DRIVERS = ["docker", "fixture"] as const;
export type RuntimeDriver = (typeof RUNTIME_DRIVERS)[number];

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(API_PORT),
  DATA_DIR: z.string().min(1).default("./data"),
  DIST_DIR: z.string().min(1).default("./dist"),
  LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
  NODE_ENV: z.enum(RUN_MODES).default("development"),
  AGENT_DRIVER: z.enum(AGENT_DRIVERS).default("sdk"),
  RUNTIME_DRIVER: z.enum(RUNTIME_DRIVERS).default("docker"),
});

export type Config = Readonly<{
  /** Selalu loopback dan tidak bisa diubah lewat env: user mesin ini anggota grup docker (setara root). */
  host: "127.0.0.1";
  port: number;
  dataDir: string;
  dbPath: string;
  /** Hasil `vite build`; hanya disajikan server di mode production dan test. */
  distDir: string;
  logLevel: LogLevel;
  mode: RunMode;
  agentDriver: AgentDriver;
  runtimeDriver: RuntimeDriver;
}>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Variabel env yang diisi string kosong dianggap tidak diisi. */
function withoutEmpty(env: Record<string, string | undefined>): Record<string, string> {
  const entries = Object.entries(env).filter((entry): entry is [string, string] => {
    const value = entry[1];
    return value !== undefined && value !== "";
  });
  return Object.fromEntries(entries);
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(withoutEmpty(env));
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new ConfigError(`Konfigurasi env tidak valid — ${detail}`);
  }
  const values = parsed.data;
  const dataDir = resolve(values.DATA_DIR);
  return {
    host: "127.0.0.1",
    port: values.PORT,
    dataDir,
    dbPath: join(dataDir, "app.db"),
    distDir: resolve(values.DIST_DIR),
    logLevel: values.LOG_LEVEL ?? (values.NODE_ENV === "test" ? "silent" : "info"),
    mode: values.NODE_ENV,
    agentDriver: values.AGENT_DRIVER,
    runtimeDriver: values.RUNTIME_DRIVER,
  };
}

/** Penanda klien untuk Claude Code (lihat dokumentasi opsi `env` di sdk.d.ts). */
const CLIENT_APP = `ai-asset-generate/${APP_VERSION}`;

/**
 * Env untuk proses Claude Code.
 *
 * Opsi `env` Agent SDK **mengganti** seluruh env, jadi env proses disalin dulu. ANTHROPIC_API_KEY dan
 * ANTHROPIC_AUTH_TOKEN dihapus supaya SDK memakai sesi login di ~/.claude, bukan API key.
 */
export function agentEnv(
  base: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  return {
    ...base,
    ANTHROPIC_API_KEY: undefined,
    ANTHROPIC_AUTH_TOKEN: undefined,
    CLAUDE_AGENT_SDK_CLIENT_APP: CLIENT_APP,
  };
}
