/**
 * `bun scripts/sdk-fixture.ts <raw.jsonl> <nama>`: stream SDK hasil eval (sudah disanitasi) → fixture kontrak
 * `tests/fixtures/sdk/<nama>.jsonl`. Delta stream dipangkas (beberapa per jenis) supaya fixture kecil;
 * sanitasi dijalankan sekali lagi.
 */
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { sanitize } from "../server/agent/sanitize.ts";

const DELTAS_PER_KIND = 5;
const NOISY = new Set(["system:thinking_tokens", "system:status", "command_lifecycle:"]);

export function trimStream(lines: readonly string[]): unknown[] {
  const kept: unknown[] = [];
  const deltas = new Map<string, number>();
  const noisy = new Map<string, number>();
  for (const line of lines) {
    if (line.trim() === "") continue;
    const message: unknown = JSON.parse(line);
    if (typeof message !== "object" || message === null || !("type" in message)) continue;
    const kind = `${String(message.type)}:${"subtype" in message ? String(message.subtype) : ""}`;
    if (message.type === "stream_event") {
      const event = "event" in message ? JSON.stringify(message.event) : "";
      const deltaKind = /"type":"(text_delta|thinking_delta|input_json_delta)"/.exec(event)?.[1] ?? "lain";
      const count = deltas.get(deltaKind) ?? 0;
      if (count >= DELTAS_PER_KIND) continue;
      deltas.set(deltaKind, count + 1);
    } else if (NOISY.has(kind)) {
      const count = noisy.get(kind) ?? 0;
      if (count >= 2) continue;
      noisy.set(kind, count + 1);
    }
    kept.push(sanitize(message, { homeDir: homedir() }));
  }
  return kept;
}

if (import.meta.main) {
  const [input, name] = process.argv.slice(2);
  if (input === undefined || name === undefined || !/^[a-z0-9-]+$/.test(name)) {
    console.error("Pemakaian: bun scripts/sdk-fixture.ts <raw.jsonl> <nama>");
    process.exit(2);
  }
  const lines = (await readFile(resolve(input), "utf8")).split("\n");
  const kept = trimStream(lines);
  const output = join(import.meta.dir, "..", "tests", "fixtures", "sdk", `${name}.jsonl`);
  await writeFile(output, `${kept.map((item) => JSON.stringify(item)).join("\n")}\n`);
  console.log(`${kept.length} dari ${lines.length} pesan → ${output}`);
}
