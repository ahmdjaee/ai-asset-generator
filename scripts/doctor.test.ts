import { describe, expect, test } from "bun:test";
import { DOCTOR_DISK_MIN_BYTES, DOCTOR_DISK_WARN_BYTES } from "../shared/limits.ts";
import { type Check, type DoctorDeps, formatReport, runDoctor } from "./doctor.ts";

const GIB = 1024 * 1024 * 1024;

function deps(overrides: Partial<DoctorDeps> = {}): DoctorDeps {
  return {
    bunVersion: "1.4.4",
    which: (command) => `/usr/local/bin/${command}`,
    account: async () => ({ loggedIn: true, apiKeySource: null }),
    dockerVersion: async () => "29.1.2",
    imageTag: async () => "asset-forge:abc",
    imageExists: async () => true,
    chromiumPresent: async () => true,
    dataDir: "/srv/app/data",
    dataDirState: async () => ({ kind: "present", isDir: true, ownedByUser: true, writable: true }),
    freeBytes: async () => 50 * GIB,
    port: async () => "free",
    ...overrides,
  };
}

const byLabel = (checks: readonly Check[], label: string) => checks.find((check) => check.label === label);

describe("doctor", () => {
  test("mesin siap: semua ok, kode keluar 0, tanpa identitas akun", async () => {
    const checks = await runDoctor(deps());
    expect(checks.filter((check) => check.status !== "ok")).toEqual([]);
    const report = formatReport(checks);
    expect(report).toEndWith("Mesin siap.");
    expect(report).toContain("✓ Login Claude");
    expect(report).not.toMatch(/@/);
  });

  test("masalah umum: setiap pemeriksaan gagal dengan petunjuk perbaikan", async () => {
    const checks = await runDoctor(
      deps({
        bunVersion: "1.3.9",
        account: async () => ({ loggedIn: false, apiKeySource: null }),
        imageExists: async () => false,
        chromiumPresent: async () => false,
        freeBytes: async () => DOCTOR_DISK_MIN_BYTES - 1,
        port: async (port) => (port === 4340 ? "other" : "app"),
        dataDirState: async () => ({ kind: "present", isDir: true, ownedByUser: false, writable: false }),
      }),
    );
    const status = Object.fromEntries(checks.map((check) => [check.label, check.status]));
    expect(status).toEqual({
      Bun: "fail",
      "CLI Claude Code": "ok",
      "Login Claude": "fail",
      Docker: "ok",
      "Image runtime 3D": "fail",
      "Chromium renderer": "fail",
      "Ruang disk": "fail",
      "Port 4340 (server)": "fail",
      "Port 4341 (Vite dev)": "ok",
      "Folder data": "fail",
    });
    for (const check of checks.filter((item) => item.status === "fail")) expect(check.hint).toBeDefined();
    const report = formatReport(checks);
    expect(report).toContain("→ Bangun image: `bun run runtime:build`");
    expect(report).toContain('sudo chown -R "$USER" /srv/app/data');
    expect(report).toEndWith("7 pemeriksaan gagal.");
  });

  test("tanpa CLI Claude dan tanpa Docker: pemeriksaan turunannya dilewati", async () => {
    const checks = await runDoctor(deps({ which: () => null, dockerVersion: async () => null }));
    expect(byLabel(checks, "CLI Claude Code")?.status).toBe("fail");
    expect(byLabel(checks, "CLI Claude Code")?.hint).toContain("~/.local/bin");
    expect(byLabel(checks, "Login Claude")?.status).toBe("skip");
    expect(byLabel(checks, "Docker")?.status).toBe("fail");
    expect(byLabel(checks, "Image runtime 3D")?.status).toBe("skip");
  });

  test("API key dari SDK, sesi gagal dibaca, disk menipis, port Vite dipakai, folder data belum ada", async () => {
    const apiKey = await runDoctor(deps({ account: async () => ({ loggedIn: true, apiKeySource: "user" }) }));
    expect(byLabel(apiKey, "Login Claude")).toMatchObject({
      status: "fail",
      detail: "memakai API key (user)",
    });

    const broken = await runDoctor(
      deps({
        account: async () => {
          throw new Error("proses keluar");
        },
        freeBytes: async () => DOCTOR_DISK_WARN_BYTES - 1,
        port: async (port) => (port === 4341 ? "other" : "free"),
        dataDirState: async () => ({ kind: "missing", parentWritable: true }),
      }),
    );
    expect(byLabel(broken, "Login Claude")?.detail).toContain("proses keluar");
    expect(byLabel(broken, "Ruang disk")?.status).toBe("warn");
    expect(byLabel(broken, "Port 4341 (Vite dev)")?.status).toBe("warn");
    expect(byLabel(broken, "Folder data")).toMatchObject({ status: "ok" });
    expect(byLabel(broken, "Folder data")?.detail).toContain("dibuat saat server start");

    const noParent = await runDoctor(
      deps({ dataDirState: async () => ({ kind: "missing", parentWritable: false }) }),
    );
    expect(byLabel(noParent, "Folder data")?.status).toBe("fail");
    const notDir = await runDoctor(
      deps({
        dataDirState: async () => ({ kind: "present", isDir: false, ownedByUser: true, writable: true }),
      }),
    );
    expect(byLabel(notDir, "Folder data")?.detail).toContain("bukan folder");
  });
});
