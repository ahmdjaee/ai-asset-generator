/**
 * Demo pipeline Tahap 2: `bun run pipeline:demo <skrip.py> [--tier ringan|sedang|maksimal] [--asset-dir <folder>]`.
 * Skrip contoh → runtime Docker → optimasi → validasi → render → versi v1 (read-only + manifest).
 * Bawaan folder aset: `.tmp/pipeline-demo/<nama>-<waktu>/` (tidak pernah menyentuh `data/`).
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { HeavyLane } from "../server/jobs/heavy-lane.ts";
import { Renderer } from "../server/render/renderer.ts";
import { requireRuntimeImage } from "../server/runtime/image.ts";
import { buildBaseVersion } from "../server/services/build-version.ts";
import { versionDir } from "../server/services/versions.ts";
import { TIER_IDS, type TierId } from "../shared/limits.ts";

const ROOT = resolve(import.meta.dir, "..");

function isTier(value: string): value is TierId {
  return TIER_IDS.some((tier) => tier === value);
}

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: { tier: { type: "string", default: "sedang" }, "asset-dir": { type: "string" } },
  allowPositionals: true,
});
const [script] = positionals;
const tier = values.tier ?? "sedang";
if (script === undefined || !isTier(tier)) {
  console.error(
    "Pemakaian: bun run pipeline:demo <skrip.py> [--tier ringan|sedang|maksimal] [--asset-dir <folder>]",
  );
  process.exit(2);
}

const name =
  script
    .split("/")
    .at(-1)
    ?.replace(/\.py$/, "")
    .replace(/[^a-z0-9-]/g, "") || "demo";
const stamp = Date.now().toString(36);
const assetDir = resolve(values["asset-dir"] ?? `${ROOT}/.tmp/pipeline-demo/${name}-${stamp}`);
const lane = new HeavyLane();
lane.on((event) => {
  if (event.type === "progress") console.log(`  ${event.pct.toFixed(0).padStart(3)}% ${event.step}`);
});
const renderer = new Renderer();

try {
  const outcome = await buildBaseVersion({
    jobId: `demo-${name}-${stamp}`,
    scriptPath: resolve(script),
    assetDir,
    jobsRoot: `${ROOT}/.tmp/jobs`,
    image: await requireRuntimeImage(),
    owner: "scripts",
    tierId: tier,
    lane,
    renderer,
  });
  if (!outcome.ok) {
    console.error(`Gagal: ${outcome.code} — ${outcome.message}`);
    if (outcome.detail) console.error(outcome.detail);
    if (outcome.validation) console.error(outcome.validation.messages);
    process.exitCode = 1;
  } else {
    const { manifest, stats, budget, timings } = outcome;
    console.log(`\nVersi v${manifest.version} → ${versionDir(assetDir, manifest.version)}`);
    for (const file of manifest.files)
      console.log(
        `  ${file.name.padEnd(12)} ${String(file.bytes).padStart(8)} B  ${file.sha256.slice(0, 16)}…`,
      );
    console.log(
      `Statistik: ${stats.triangles} segitiga, ${stats.vertices} vertex, bbox ${stats.bbox.size.join(" × ")} m`,
    );
    for (const item of budget.items)
      console.log(`  budget ${item.key}: ${item.value} / maks ${item.max} → ${item.status}`);
    console.log(`Validator: ${outcome.validation.errors} error, ${outcome.validation.warnings} warning`);
    console.log(
      `Waktu: runtime ${timings.runtimeMs} ms, pipeline ${timings.pipelineMs} ms, render ${timings.renderMs} ms, total ${timings.totalMs} ms`,
    );
    console.log(`Contact sheet: ${outcome.contactSheetPath}`);
  }
} finally {
  await renderer.close();
}
