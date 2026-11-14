/** Percobaan lolos sandbox. Butuh Docker + image runtime: `RUNTIME_IT=1 bun test tests/integration/runtime`. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { DEFAULT_COMMAND } from "../../../server/runtime/docker.ts";
import { collectOutputs } from "../../../server/runtime/outputs.ts";
import { BASE_JOB_LIMITS, BASE_OUTPUT_MAX_BYTES, type JobLimits } from "../../../shared/limits.ts";
import { cleanup, ENABLED, leftoverJobContainers, requireImage, runScript, SCRIPTS_DIR } from "./helpers.ts";

const PLAIN_PYTHON = ["python", "/job/script.py"];
const SHORT: JobLimits = { ...BASE_JOB_LIMITS, timeoutMs: 60_000 };

describe.skipIf(!ENABLED)("sandbox runtime", () => {
  let image = "";

  beforeAll(async () => {
    image = await requireImage();
  });

  afterAll(async () => {
    expect(await leftoverJobContainers()).toEqual([]);
  });

  test("tidak ada akses jaringan", async () => {
    const run = await runScript(image, join(SCRIPTS_DIR, "escape_network.py"), {
      limits: SHORT,
      command: PLAIN_PYTHON,
    });
    try {
      expect(run.result.exitCode).toBe(0);
      expect(run.result.stdoutTail.trim()).toBe("SANDBOX_OK");
    } finally {
      await cleanup(run);
    }
  }, 90_000);

  test("tidak bisa menulis di luar /job dan /tmp; bukan root; tanpa capability", async () => {
    const run = await runScript(image, join(SCRIPTS_DIR, "escape_fs.py"), {
      limits: SHORT,
      command: PLAIN_PYTHON,
    });
    try {
      expect(run.result.exitCode).toBe(0);
      expect(run.result.stdoutTail.trim()).toBe(`SANDBOX_OK uid=${process.getuid?.() ?? -1}`);
    } finally {
      await cleanup(run);
    }
  }, 90_000);

  test("fork bomb dihentikan pids-limit", async () => {
    const run = await runScript(image, join(SCRIPTS_DIR, "fork_bomb.py"), {
      limits: SHORT,
      command: PLAIN_PYTHON,
    });
    try {
      expect(run.result.exitCode).toBe(0);
      const match = /FORK limited=(\w+) children=(\d+)/.exec(run.result.stdoutTail);
      expect(match?.[1]).toBe("True");
      expect(Number(match?.[2])).toBeLessThan(BASE_JOB_LIMITS.pids);
    } finally {
      await cleanup(run);
    }
  }, 90_000);

  test("alokasi memori besar terdeteksi sebagai OOM", async () => {
    const limits: JobLimits = { ...SHORT, memoryBytes: 256 * 1024 * 1024 };
    const run = await runScript(image, join(SCRIPTS_DIR, "memory_hog.py"), { limits, command: PLAIN_PYTHON });
    try {
      expect(run.result.oom).toBe(true);
      expect(run.result.exitCode).toBe(137);
      expect(run.result.timedOut).toBe(false);
    } finally {
      await cleanup(run);
    }
  }, 90_000);

  test("loop tak berujung dihentikan timeout dan container di-kill", async () => {
    const limits: JobLimits = { ...SHORT, timeoutMs: 4_000 };
    const progress: string[] = [];
    const run = await runScript(image, join(SCRIPTS_DIR, "infinite_loop.py"), {
      limits,
      command: DEFAULT_COMMAND,
      onProgress: (event) => progress.push(event.step),
    });
    try {
      expect(run.result.timedOut).toBe(true);
      expect(run.result.exitCode).not.toBe(0);
      expect(run.result.durationMs).toBeLessThan(30_000);
      expect(progress).toContain("berputar");
    } finally {
      await cleanup(run);
    }
  }, 90_000);

  test("job bisa dibatalkan lewat AbortSignal", async () => {
    const controller = new AbortController();
    const run = await runScript(image, join(SCRIPTS_DIR, "infinite_loop.py"), {
      limits: SHORT,
      command: DEFAULT_COMMAND,
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });
    try {
      expect(run.result.cancelled).toBe(true);
      expect(run.result.timedOut).toBe(false);
      expect(run.result.durationMs).toBeLessThan(30_000);
    } finally {
      await cleanup(run);
    }
  }, 90_000);

  test("symlink ke /etc/passwd dan file asing di output tidak diterima", async () => {
    const run = await runScript(image, join(SCRIPTS_DIR, "symlink_output.py"), {
      limits: SHORT,
      command: PLAIN_PYTHON,
    });
    try {
      expect(run.result.exitCode).toBe(0);
      const scan = await collectOutputs(run.dir.outputDir, BASE_OUTPUT_MAX_BYTES);
      expect(scan.accepted).toEqual([]);
      expect(scan.rejected).toEqual([
        { name: "base.glb", reason: "symlink" },
        { name: "run.sh", reason: "not_allowed" },
        { name: "stats.json", reason: "not_file" },
      ]);
    } finally {
      await cleanup(run);
    }
  }, 90_000);
});
