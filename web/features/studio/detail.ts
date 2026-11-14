/**
 * Data panel Detail viewer dari versi sungguhan (fungsi murni): meter anggaran tier, baris statistik, daftar versi,
 * dan bagian Optimasi. Angka dan teks mengikuti desain layar 02 dan frame "Tahap 9 · komponen Studio" F.
 */
import type { BudgetMeter, StatRow } from "@/components/BudgetStats.tsx";
import type { VersionItem } from "@/components/VersionList.tsx";
import { t } from "@/i18n/id.ts";
import type { AssetStats } from "../../../shared/asset-stats.ts";
import { formatBytes, formatNumber, formatRelativeTime } from "../../../shared/format.ts";
import { checkBudget, type TierBudget } from "../../../shared/limits.ts";
import type { OptimizeSummary } from "../../../shared/version-report.ts";

type VersionLike = Readonly<{
  n: number;
  stage: "base" | "textured";
  stats: AssetStats;
  files: ReadonlyArray<Readonly<{ name: string; bytes: number }>>;
  createdAt: number;
  optimize: OptimizeSummary | null;
}>;

export function fileBytes(version: VersionLike, name: string): number | null {
  return version.files.find((file) => file.name === name)?.bytes ?? null;
}

/** File GLB sumber versi (sebelum optimasi web). */
function sourceFile(version: VersionLike): string {
  return version.stage === "textured" ? "final.glb" : "base.glb";
}

/**
 * Meter anggaran (FigCraft #1244). Dalam target: segitiga dibandingkan target ("3.388 / 8.000"), ukuran web.glb
 * dibandingkan maks tier ("164 KB / 1,5 MB"). Lewat target: warning, lewat maks: danger, keduanya "… / … maks".
 */
export function budgetMeters(stats: AssetStats, webBytes: number | null, tier: TierBudget): BudgetMeter[] {
  const { budget } = t;
  const check = checkBudget(stats, tier, webBytes ?? undefined);
  const status = (key: string) => check.items.find((entry) => entry.key === key)?.status ?? "ok";
  const meter = (
    label: string,
    value: number,
    format: (value: number) => string,
    range: Readonly<{ target: number; max: number }>,
    inBudget: number,
    state: string,
  ): BudgetMeter =>
    state === "ok"
      ? { label, valueText: budget.ofTarget(format(value), format(inBudget)), ratio: value / inBudget }
      : {
          label,
          valueText: budget.ofMax(format(value), format(range.max)),
          ratio: value / range.max,
          tone: state === "over_max" ? "danger" : "warning",
        };
  const meters = [
    meter(
      budget.triangles,
      stats.triangles,
      (value) => formatNumber(value),
      tier.triangles,
      tier.triangles.target,
      status("triangles"),
    ),
  ];
  if (webBytes !== null) {
    meters.push(
      meter(budget.size, webBytes, formatBytes, tier.webBytes, tier.webBytes.max, status("webBytes")),
    );
  }
  return meters;
}

/** Baris statistik: vertex, material (bentuk dasar belum punya), dimensi bbox (sumbu glTF: X lebar, Z dalam, Y tinggi). */
export function statRows(version: VersionLike): StatRow[] {
  const { budget } = t;
  const [width, height, depth] = version.stats.bbox.size;
  const metres = (value: number) => formatNumber(value, 2);
  return [
    { label: budget.vertex, value: formatNumber(version.stats.vertices) },
    {
      label: budget.material,
      value:
        version.stage === "textured"
          ? t.session.materials(formatNumber(version.stats.materials))
          : budget.materialPending,
    },
    { label: budget.dimensions, value: budget.dimensionsValue(metres(width), metres(depth), metres(height)) },
  ];
}

/**
 * Daftar versi untuk panel: terbaru di bawah, sama dengan urutan pembuatan. `thumbnail` memberi URL gambar kecil tiap
 * versi (thumbnail turntable), atau `undefined` selama gambarnya belum dibuat.
 */
export function versionItems<V extends VersionLike>(
  versions: readonly V[],
  now: number,
  thumbnail?: (version: V) => string | undefined,
): VersionItem[] {
  return versions.map((version) => {
    const src = thumbnail?.(version);
    return {
      version: version.n,
      title: t.session.versionTitle(version.n, version.stage === "textured"),
      meta: t.session.versionMeta(
        formatRelativeTime(version.createdAt, now),
        formatNumber(version.stats.triangles),
      ),
      ...(src === undefined ? {} : { thumbnail: src }),
    };
  });
}

export type OptimizationView = Readonly<{ size: string; triangles: string; steps: string }>;

const STEP_NAMES: Readonly<Record<string, string>> = t.optimization.stepNames;

function stepLabel(step: string): string {
  return STEP_NAMES[step.startsWith("resize.") ? "resize" : step] ?? step;
}

/**
 * Bagian Optimasi (FigCraft "Panel detail (optimasi)" #4113): ukuran file sumber → web.glb, segitiga sebelum →
 * sesudah simplify (tanpa simplify: satu angka), dan langkah pipeline. Perkecil tekstur per slot ditulis sekali;
 * web.glb selalu dikompres meshopt dan teksturnya diubah ke WebP.
 *
 * Hanya untuk aset final (PLAN Tahap 9: laporan optimasi di review final; layar 02 review bentuk dasar tanpa
 * Optimasi). `null` juga untuk versi lama tanpa ringkasan.
 */
export function optimizationSummary(version: VersionLike): OptimizationView | null {
  const { optimize } = version;
  if (version.stage !== "textured" || optimize === null) return null;
  const source = fileBytes(version, sourceFile(version));
  const web = fileBytes(version, "web.glb");
  const { change, separator } = t.optimization;
  const size =
    source === null || web === null
      ? formatBytes(web ?? source ?? Number.NaN)
      : change(formatBytes(source), formatBytes(web));
  const triangles =
    optimize.simplified === null
      ? formatNumber(version.stats.triangles)
      : change(formatNumber(optimize.simplified.from), formatNumber(optimize.simplified.to));
  const labels: string[] = [];
  for (const step of optimize.steps) {
    const label = stepLabel(step);
    if (!labels.includes(label)) labels.push(label);
  }
  if (version.stats.textures.length > 0) labels.push(STEP_NAMES.webp ?? "webp");
  labels.push(STEP_NAMES.meshopt ?? "meshopt");
  const steps = labels.join(separator);
  return { size, triangles, steps: steps.charAt(0).toUpperCase() + steps.slice(1) };
}
