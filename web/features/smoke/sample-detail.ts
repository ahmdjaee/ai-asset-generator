import { t, tSmoke } from "@/i18n/id.ts";
import { formatBytes, formatNumber } from "../../../shared/format.ts";
import { DEFAULT_TIERS } from "../../../shared/limits.ts";
import type { DetailPanelData } from "../viewer/DetailPanel.tsx";

/** Angka contoh panel Detail sama dengan desain (layar 02), supaya tangkapan bisa dibandingkan dengan ekspor FigCraft. */
export function sampleDetail(
  final: boolean,
  onVersionChange: (version: number) => void,
  extra: Partial<Pick<DetailPanelData, "optimization" | "validation">> = {},
): DetailPanelData {
  const tier = DEFAULT_TIERS.sedang;
  const b = t.budget;
  const page = tSmoke.viewerPage;
  return {
    tier: "sedang",
    meters: [
      {
        label: b.triangles,
        valueText: b.ofTarget(formatNumber(3388), formatNumber(tier.triangles.target)),
        ratio: 3388 / tier.triangles.target,
      },
      {
        label: b.size,
        valueText: b.ofTarget(formatBytes(164_000), formatBytes(tier.webBytes.max)),
        ratio: 164_000 / tier.webBytes.max,
      },
    ],
    rows: [
      { label: b.vertex, value: formatNumber(1954) },
      { label: b.material, value: final ? page.materialFinal(formatNumber(1)) : b.materialPending },
      {
        label: b.dimensions,
        value: b.dimensionsValue(formatNumber(0.65, 2), formatNumber(0.44, 2), formatNumber(0.53, 2)),
      },
    ],
    versions: [
      { version: 1, title: page.versionBase, meta: page.versionMeta(formatNumber(3388)) },
      ...(final
        ? [{ version: 2, title: page.versionFinal, meta: page.versionMeta(formatNumber(7940)) }]
        : []),
    ],
    version: final ? 2 : 1,
    onVersionChange,
    validation: { errors: 0, warnings: 0 },
    ...extra,
  };
}
