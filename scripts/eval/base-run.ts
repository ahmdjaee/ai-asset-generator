/** Membaca hasil `eval:base` (Tahap 3) sebagai titik awal `eval:texture`: sesi, versi yang dikirim, dan brief. */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { Brief } from "../../shared/brief.ts";

export type BaseRun = Readonly<{
  sessionId: string;
  version: number;
  summary: string;
  brief: Brief | null;
}>;

const Line = z.discriminatedUnion("type", [
  z.object({ type: z.literal("init"), sessionId: z.string().min(1) }),
  z.object({ type: z.literal("submitted"), version: z.number().int().positive(), summary: z.string() }),
  z.object({ type: z.literal("brief"), brief: Brief }),
]);
const Typed = z.object({ type: z.string() });

/** Dari `transcript.jsonl`: session id pertama, submit terakhir, dan brief terakhir. Murni. */
export function parseBaseTranscript(text: string): BaseRun | null {
  let sessionId: string | null = null;
  let submitted: { version: number; summary: string } | null = null;
  let brief: Brief | null = null;
  for (const raw of text.split("\n")) {
    if (raw.trim() === "") continue;
    const json: unknown = JSON.parse(raw);
    const kind = Typed.safeParse(json);
    if (!kind.success || !["init", "submitted", "brief"].includes(kind.data.type)) continue;
    const line = Line.parse(json);
    if (line.type === "init") sessionId ??= line.sessionId;
    else if (line.type === "submitted") submitted = { version: line.version, summary: line.summary };
    else brief = line.brief;
  }
  if (sessionId === null || submitted === null) return null;
  return { sessionId, ...submitted, brief };
}

export type FoundBaseRun = BaseRun & Readonly<{ caseDir: string; assetDir: string }>;

/** Run `eval:base` terbaru yang punya kasus `caseId` dengan folder aset dan versi yang dikirim. */
export async function findBaseRun(runsDir: string, caseId: string): Promise<FoundBaseRun | null> {
  const runs = (await readdir(runsDir).catch(() => [])).sort().reverse();
  for (const run of runs) {
    const caseDir = join(runsDir, run, caseId);
    const assetDir = join(caseDir, "asset");
    if ((await stat(assetDir).catch(() => null))?.isDirectory() !== true) continue;
    const text = await readFile(join(caseDir, "transcript.jsonl"), "utf8").catch(() => null);
    const parsed = text === null ? null : parseBaseTranscript(text);
    if (parsed !== null) return { ...parsed, caseDir, assetDir };
  }
  return null;
}
