/** Unit systemd `deploy/ai-asset-generate.service` (PLAN Tahap 12): baris yang wajib ada tidak boleh hilang diam-diam. */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { API_PORT } from "../../shared/ports.ts";

const ROOT = join(import.meta.dir, "../..");

/** Pasangan `Kunci=nilai` per bagian; komentar dan baris kosong dibuang. */
async function unit(): Promise<Map<string, string[]>> {
  const text = await readFile(join(ROOT, "deploy/ai-asset-generate.service"), "utf8");
  const values = new Map<string, string[]>();
  let section = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const header = /^\[(\w+)\]$/.exec(line);
    if (header?.[1] !== undefined) {
      section = header[1];
      continue;
    }
    const eq = line.indexOf("=");
    const key = `${section}.${line.slice(0, eq)}`;
    values.set(key, [...(values.get(key) ?? []), line.slice(eq + 1)]);
  }
  return values;
}

describe("unit systemd", () => {
  test("PATH memuat ~/.bun/bin dan ~/.local/bin; mode production; folder kerja = root repo", async () => {
    const values = await unit();
    const env = values.get("Service.Environment") ?? [];
    const path =
      env
        .find((item) => item.startsWith("PATH="))
        ?.slice("PATH=".length)
        .split(":") ?? [];
    expect(path).toContain("%h/.bun/bin");
    expect(path).toContain("%h/.local/bin");
    expect(env).toContain("NODE_ENV=production");
    expect(values.get("Service.WorkingDirectory")).toEqual(["/var/www/ai-asset-generate"]);
    expect(values.get("Service.ExecStart")).toEqual(["%h/.bun/bin/bun server/main.ts"]);
  });

  test("berhenti dengan rapi, restart bila gagal, mulai saat login; tanpa API key dan tanpa port/host lain", async () => {
    const values = await unit();
    expect(Number(values.get("Service.TimeoutStopSec")?.[0])).toBeGreaterThanOrEqual(20);
    expect(values.get("Service.Restart")).toEqual(["on-failure"]);
    expect(values.get("Install.WantedBy")).toEqual(["default.target"]);
    expect(values.get("Unit.Description")?.[0]).toContain(`127.0.0.1:${API_PORT}`);
    const env = (values.get("Service.Environment") ?? []).join("\n");
    expect(env).not.toMatch(/ANTHROPIC_|PORT=|HOST=|AGENT_DRIVER|RUNTIME_DRIVER/);
  });
});
