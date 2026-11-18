/**
 * Perintah runtime 3D:
 * - `build`: bangun image `asset-forge:<hash>` (dilewati bila sudah ada; `--force` untuk membangun ulang);
 * - `test-assetkit`: pytest `runtime/tests` di dalam image, dengan flag sandbox yang sama dengan job sungguhan;
 * - `samples`: jalankan `runtime/samples/*.py` dan simpan GLB + statistik ke `tests/fixtures/glb/`;
 * - `textured-samples`: jalankan `runtime/samples/textured/*.py` (tier Sedang) → `tests/fixtures/glb/textured/`
 *   (tekstur diperkecil ke 512 px dan dikodekan ulang ke JPEG supaya fixture kecil) + bentuk dasar yang cocok
 *   (`<nama>-base.glb`);
 * - `blend-fixtures`: `.blend` untuk pasangan fixture `RUNTIME_DRIVER=fixture` (preset ekspor Sumber) →
 *   `tests/fixtures/glb/textured/<nama>{-base,}.blend`; GLB fixture tidak ditimpa;
 * - `probe <skrip.py> [--out DIR] [--base | --textured TIER [--budget budget.json] [--base-script base.py]]`: jalankan satu skrip mentah,
 *   lewat harness bentuk dasar (`--base`), atau alur bertekstur penuh per tier (mis. `runtime/probes/*`) dengan batas
 *   job bertekstur dan pustaka material. `--base-script` disalin ke job sebagai `base.py` (untuk `scene.run_base()`,
 *   mis. skrip dari ZIP ekspor Sumber). Isi `/job/out` disalin ke DIR (bawaan `.tmp/probe-out`).
 */
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { textureCompress } from "@gltf-transform/functions";
import sharp from "sharp";
import { z } from "zod";
import { loadConfig } from "../server/config.ts";
import { readGlb, writeGlb } from "../server/pipeline/io.ts";
import { buildImage, imageExists, type JobResult, runJob } from "../server/runtime/docker.ts";
import { ASSETKIT_DIR, RUNTIME_DIR, requireRuntimeImage, runtimeImageTag } from "../server/runtime/image.ts";
import {
  BASE_JOB_COMMAND,
  BLEND_OUTPUT,
  createJobDir,
  removeJobDir,
  texturedJobCommand,
} from "../server/runtime/job-dir.ts";
import { collectOutputs } from "../server/runtime/outputs.ts";
import {
  BASE_JOB_LIMITS,
  BASE_OUTPUT_MAX_BYTES,
  bakeSizes,
  DEFAULT_TIERS,
  TEST_JOB_LIMITS,
  TEXTURED_MAX_JOB_LIMITS,
  TEXTURED_OUTPUT_MAX_BYTES,
  TIER_IDS,
  type TierBudget,
  TierBudgetSchema,
  type TierId,
  texturedJobLimits,
} from "../shared/limits.ts";

const ROOT = join(import.meta.dir, "..");
const JOBS_ROOT = join(ROOT, ".tmp", "jobs");
const FIXTURE_DIR = join(ROOT, "tests", "fixtures", "glb");
const SCRIPT_OWNER = "scripts";

function jobId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function mib(bytes: number | null): string {
  return bytes === null ? "?" : `${(bytes / 1024 / 1024).toFixed(0)} MiB`;
}

function printFailure(result: JobResult): void {
  console.error(result.stdoutTail);
  console.error(result.stderrTail);
}

async function build(force: boolean): Promise<void> {
  const tag = await runtimeImageTag();
  if (!force && (await imageExists(tag))) {
    console.log(`Image ${tag} sudah ada; dilewati (pakai --force untuk membangun ulang).`);
    return;
  }
  console.log(`Membangun ${tag} …`);
  await buildImage(RUNTIME_DIR, tag);
  console.log(`Selesai: ${tag}`);
}

async function testAssetkit(): Promise<void> {
  const image = await requireRuntimeImage();
  const dir = await createJobDir(JOBS_ROOT);
  try {
    await cp(join(RUNTIME_DIR, "tests"), join(dir.path, "tests"), { recursive: true });
    const result = await runJob({
      jobId: jobId("pytest"),
      image,
      mounts: { jobDir: dir.path, assetkitDir: ASSETKIT_DIR },
      limits: TEST_JOB_LIMITS,
      owner: SCRIPT_OWNER,
      command: ["python", "-m", "pytest", "-q", "-p", "no:cacheprovider", "/job/tests"],
    });
    console.log(result.stdoutTail.trimEnd());
    if (result.exitCode !== 0) {
      console.error(result.stderrTail);
      console.error(`pytest gagal (kode ${result.exitCode}, timeout ${result.timedOut}, OOM ${result.oom}).`);
      process.exit(1);
    }
    console.log(
      `pytest lolos dalam ${(result.durationMs / 1000).toFixed(1)} dtk (termasuk start container).`,
    );
  } finally {
    await removeJobDir(JOBS_ROOT, dir);
  }
}

async function samples(): Promise<void> {
  const image = await requireRuntimeImage();
  const sampleDir = join(RUNTIME_DIR, "samples");
  const scripts = (await readdir(sampleDir)).filter((name) => name.endsWith(".py")).sort();
  await mkdir(FIXTURE_DIR, { recursive: true });
  for (const script of scripts) {
    const name = basename(script, ".py");
    const dir = await createJobDir(JOBS_ROOT, join(sampleDir, script));
    try {
      const result = await runJob({
        jobId: jobId(`sample-${name}`),
        image,
        mounts: { jobDir: dir.path, assetkitDir: ASSETKIT_DIR },
        limits: BASE_JOB_LIMITS,
        owner: SCRIPT_OWNER,
        command: BASE_JOB_COMMAND,
      });
      const outputs = await collectOutputs(dir.outputDir, BASE_OUTPUT_MAX_BYTES);
      const glb = outputs.accepted.find((file) => file.name === "base.glb");
      const stats = outputs.accepted.find((file) => file.name === "stats.json");
      if (result.exitCode !== 0 || glb === undefined || stats === undefined || outputs.rejected.length > 0) {
        printFailure(result);
        console.error(`Contoh ${name} gagal (kode ${result.exitCode}).`, outputs.rejected);
        process.exit(1);
      }
      await writeFile(join(FIXTURE_DIR, `${name}.glb`), await readFile(glb.path));
      await writeFile(join(FIXTURE_DIR, `${name}.stats.json`), await readFile(stats.path));
      console.log(
        `${name}: ${(result.durationMs / 1000).toFixed(2)} dtk, RAM puncak ${mib(result.peakMemBytes)}, ${glb.bytes} B`,
      );
    } finally {
      await removeJobDir(JOBS_ROOT, dir);
    }
  }
}

async function texturedSamples(): Promise<void> {
  const image = await requireRuntimeImage();
  const sampleDir = join(RUNTIME_DIR, "samples", "textured");
  const outDir = join(FIXTURE_DIR, "textured");
  const materialsDir = join(loadConfig().dataDir, "library", "materials");
  const scripts = (await readdir(sampleDir)).filter((name) => name.endsWith(".py")).sort();
  await mkdir(outDir, { recursive: true });
  for (const script of scripts) {
    const name = basename(script, ".py");
    const baseScript = join(RUNTIME_DIR, "samples", `${name}.py`);
    const dir = await createJobDir(JOBS_ROOT, join(sampleDir, script), { "base.py": baseScript });
    try {
      const result = await runJob({
        jobId: jobId(`textured-${name}`),
        image,
        mounts: { jobDir: dir.path, assetkitDir: ASSETKIT_DIR, materialsDir },
        limits: texturedJobLimits(DEFAULT_TIERS.sedang),
        owner: SCRIPT_OWNER,
        command: texturedJobCommand(bakeSizes(DEFAULT_TIERS.sedang)),
      });
      const outputs = await collectOutputs(dir.outputDir, TEXTURED_OUTPUT_MAX_BYTES);
      const glb = outputs.accepted.find((file) => file.name === "final.glb");
      if (result.exitCode !== 0 || glb === undefined) {
        printFailure(result);
        console.error(`Contoh bertekstur ${name} gagal (kode ${result.exitCode}).`);
        process.exit(1);
      }
      const document = await readGlb(new Uint8Array(await readFile(glb.path)));
      await document.transform(
        textureCompress({ encoder: sharp, targetFormat: "jpeg", quality: 80, resize: [512, 512] }),
      );
      const data = await writeGlb(document);
      await writeFile(join(outDir, `${name}.glb`), data);
      console.log(
        `${name}: ${(result.durationMs / 1000).toFixed(2)} dtk, RAM puncak ${mib(result.peakMemBytes)}, ${data.byteLength} B`,
      );
    } finally {
      await removeJobDir(JOBS_ROOT, dir);
    }
    await texturedBaseFixture(image, name, join(outDir, `${name}-base.glb`));
  }
}

/** Bentuk dasar yang cocok dengan fixture bertekstur (fixture bentuk dasar lama dibekukan untuk golden render). */
async function texturedBaseFixture(image: string, name: string, outPath: string): Promise<void> {
  const dir = await createJobDir(JOBS_ROOT, join(RUNTIME_DIR, "samples", `${name}.py`));
  try {
    const result = await runJob({
      jobId: jobId(`base-${name}`),
      image,
      mounts: { jobDir: dir.path, assetkitDir: ASSETKIT_DIR },
      limits: BASE_JOB_LIMITS,
      owner: SCRIPT_OWNER,
      command: BASE_JOB_COMMAND,
    });
    const outputs = await collectOutputs(dir.outputDir, BASE_OUTPUT_MAX_BYTES);
    const glb = outputs.accepted.find((file) => file.name === "base.glb");
    if (result.exitCode !== 0 || glb === undefined) {
      printFailure(result);
      console.error(`Bentuk dasar ${name} gagal (kode ${result.exitCode}).`);
      process.exit(1);
    }
    await writeFile(outPath, new Uint8Array(await readFile(glb.path)));
  } finally {
    await removeJobDir(JOBS_ROOT, dir);
  }
}

/** Fixture yang diberi `.blend` (pasangan `FIXTURE_PAIR` di `server/agent/forge/fixture-builder.ts`). */
const BLEND_FIXTURES = ["peti"] as const;

type BlendJob = Readonly<{
  script: string;
  extras?: Readonly<Record<string, string>>;
  materialsDir?: string;
  limits: Parameters<typeof runJob>[0]["limits"];
  command: readonly string[];
  outputs: Readonly<Record<string, number>>;
}>;

/** Menjalankan skrip lewat harness dan hanya menyimpan `.blend`-nya. */
async function saveBlendOutput(image: string, job: BlendJob, outPath: string): Promise<void> {
  const dir = await createJobDir(JOBS_ROOT, job.script, job.extras ?? {});
  try {
    const result = await runJob({
      jobId: jobId("blend"),
      image,
      mounts: {
        jobDir: dir.path,
        assetkitDir: ASSETKIT_DIR,
        ...(job.materialsDir === undefined ? {} : { materialsDir: job.materialsDir }),
      },
      limits: job.limits,
      owner: SCRIPT_OWNER,
      command: job.command,
    });
    const outputs = await collectOutputs(dir.outputDir, job.outputs);
    const blend = outputs.accepted.find((file) => file.name === BLEND_OUTPUT);
    if (result.exitCode !== 0 || blend === undefined) {
      printFailure(result);
      console.error(`.blend ${basename(outPath)} gagal (kode ${result.exitCode}).`);
      process.exit(1);
    }
    await writeFile(outPath, new Uint8Array(await readFile(blend.path)));
    console.log(`${basename(outPath)}: ${blend.bytes} B`);
  } finally {
    await removeJobDir(JOBS_ROOT, dir);
  }
}

/**
 * `.blend` fixture: tahap tekstur memakai tier Ringan (atlas 512 px, tanpa normal/ORM) supaya file kecil; isinya
 * hanya pengganti untuk tes ekspor Sumber, bukan acuan kualitas.
 */
async function blendFixtures(): Promise<void> {
  const image = await requireRuntimeImage();
  const materialsDir = join(loadConfig().dataDir, "library", "materials");
  const outDir = join(FIXTURE_DIR, "textured");
  for (const name of BLEND_FIXTURES) {
    const baseScript = join(RUNTIME_DIR, "samples", `${name}.py`);
    await saveBlendOutput(
      image,
      {
        script: baseScript,
        limits: BASE_JOB_LIMITS,
        command: BASE_JOB_COMMAND,
        outputs: BASE_OUTPUT_MAX_BYTES,
      },
      join(outDir, `${name}-base.blend`),
    );
    await saveBlendOutput(
      image,
      {
        script: join(RUNTIME_DIR, "samples", "textured", `${name}.py`),
        extras: { "base.py": baseScript },
        materialsDir,
        limits: texturedJobLimits(DEFAULT_TIERS.ringan),
        command: texturedJobCommand(bakeSizes(DEFAULT_TIERS.ringan)),
        outputs: TEXTURED_OUTPUT_MAX_BYTES,
      },
      join(outDir, `${name}.blend`),
    );
  }
}

/** `budget.json` dari ZIP Sumber: snapshot budget aset (bisa berbeda dari `DEFAULT_TIERS` bila diubah di Pengaturan). */
const BudgetFile = z.object({ tierId: z.enum(TIER_IDS), budget: TierBudgetSchema });

async function readBudget(path: string | undefined, tierId: TierId): Promise<TierBudget> {
  if (path === undefined) return DEFAULT_TIERS[tierId];
  const file = BudgetFile.parse(JSON.parse(await readFile(path, "utf8")));
  if (file.tierId !== tierId) throw new Error(`budget.json untuk tier ${file.tierId}, bukan ${tierId}`);
  return file.budget;
}

async function probe(
  script: string | undefined,
  outDir: string,
  tierId: TierId | undefined,
  base: boolean,
  baseScript: string | undefined,
  budgetPath: string | undefined,
): Promise<void> {
  if (script === undefined) {
    console.error("Pemakaian: bun scripts/runtime.ts probe <skrip.py> [--out DIR]");
    process.exit(2);
  }
  const budget = tierId === undefined ? undefined : await readBudget(budgetPath, tierId);
  const image = await requireRuntimeImage();
  const materialsDir = join(loadConfig().dataDir, "library", "materials");
  await mkdir(materialsDir, { recursive: true });
  const dir = await createJobDir(
    JOBS_ROOT,
    script,
    baseScript === undefined ? {} : { "base.py": baseScript },
  );
  try {
    const result = await runJob({
      jobId: jobId("probe"),
      image,
      mounts: { jobDir: dir.path, assetkitDir: ASSETKIT_DIR, materialsDir },
      limits: TEXTURED_MAX_JOB_LIMITS,
      owner: SCRIPT_OWNER,
      command:
        budget !== undefined
          ? texturedJobCommand(bakeSizes(budget))
          : base
            ? [...BASE_JOB_COMMAND]
            : ["python", "/job/script.py"],
    });
    console.log(result.stdoutTail.trimEnd());
    await mkdir(outDir, { recursive: true });
    await cp(dir.outputDir, outDir, { recursive: true });
    console.log(
      `kode ${result.exitCode}, ${(result.durationMs / 1000).toFixed(1)} dtk, RAM puncak ${mib(result.peakMemBytes)}, timeout ${result.timedOut}, OOM ${result.oom}`,
    );
    if (result.exitCode !== 0) {
      console.error(result.stderrTail);
      process.exit(1);
    }
  } finally {
    await removeJobDir(JOBS_ROOT, dir);
  }
}

function flag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function tierFlag(args: readonly string[]): TierId | undefined {
  const value = flag(args, "--textured");
  if (value === undefined) return undefined;
  const tier = TIER_IDS.find((id) => id === value);
  if (tier === undefined) throw new Error(`tier tidak dikenal: ${value}`);
  return tier;
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case "build":
    await build(rest.includes("--force"));
    break;
  case "test-assetkit":
    await testAssetkit();
    break;
  case "samples":
    await samples();
    break;
  case "textured-samples":
    await texturedSamples();
    break;
  case "blend-fixtures":
    await blendFixtures();
    break;
  case "probe":
    await probe(
      rest[0],
      flag(rest, "--out") ?? join(ROOT, ".tmp", "probe-out"),
      tierFlag(rest),
      rest.includes("--base"),
      flag(rest, "--base-script"),
      flag(rest, "--budget"),
    );
    break;
  default:
    console.error(
      "Pemakaian: bun scripts/runtime.ts <build [--force] | test-assetkit | samples | textured-samples | blend-fixtures | probe <skrip.py>>",
    );
    process.exit(2);
}
