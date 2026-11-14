import { CircleAlert, CircleCheck, PanelRight } from "lucide-react";
import { type Ref, useId } from "react";
import { type BudgetMeter, BudgetStats, type StatRow } from "@/components/BudgetStats.tsx";
import { IconButton } from "@/components/ui/icon-button.tsx";
import { type VersionItem, VersionList } from "@/components/VersionList.tsx";
import { t } from "@/i18n/id.ts";
import { cn } from "@/lib/utils.ts";
import { formatNumber } from "../../../shared/format.ts";
import type { TierId } from "../../../shared/limits.ts";

export type ValidationSummary = Readonly<{ errors: number; warnings: number }>;

/** Ringkasan optimasi versi yang sudah diformat (FigCraft "Panel detail (optimasi)" #4113). */
export type OptimizationRows = Readonly<{ size: string; triangles: string; steps: string }>;

export type DetailPanelData = Readonly<{
  tier: TierId;
  meters: readonly BudgetMeter[];
  rows: readonly StatRow[];
  versions: readonly VersionItem[];
  version: number;
  onVersionChange: (version: number) => void;
  /** `null` untuk versi lama tanpa ringkasan build: baris validasi tidak ditampilkan. */
  validation: ValidationSummary | null;
  optimization?: OptimizationRows | null;
}>;

function Divider() {
  return <div aria-hidden="true" className="h-px shrink-0 bg-border-default" />;
}

/**
 * Bagian Optimasi (FigCraft #4113): padding 16, jarak 8, judul Overline. Ukuran dan segitiga satu baris (kunci Caption
 * `text/tertiary` kiri, nilai Caption `text/secondary` angka tabular kanan); langkah bertumpuk (jarak 2).
 */
function Optimization({ rows }: { rows: OptimizationRows }) {
  const titleId = useId();
  const { optimization } = t;
  const pair = "flex justify-between gap-3 text-caption";
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2 p-4">
      <h3 id={titleId} className="text-overline text-text-tertiary uppercase">
        {optimization.title}
      </h3>
      <dl className="flex flex-col gap-2">
        <div className={pair}>
          <dt className="text-text-tertiary">{optimization.size}</dt>
          <dd className="text-right text-text-secondary tabular-nums">{rows.size}</dd>
        </div>
        <div className={pair}>
          <dt className="text-text-tertiary">{optimization.triangles}</dt>
          <dd className="text-right text-text-secondary tabular-nums">{rows.triangles}</dd>
        </div>
        <div className="flex flex-col gap-0.5 text-caption">
          <dt className="text-text-tertiary">{optimization.steps}</dt>
          <dd className="text-text-secondary">{rows.steps}</dd>
        </div>
      </dl>
    </section>
  );
}

/**
 * Panel detail viewer (FigCraft #1232): lebar 280, `bg/panel`, garis `border/default`, radius 12. Kepala 44 px
 * (padding 8/8/8/16, Label "Detail" + IconButton panel-right), statistik budget, daftar versi (judul Overline), lalu
 * baris validasi glTF (Caption `text/secondary`, ikon 16).
 */
export function DetailPanel({
  data,
  onCollapse,
  collapseRef,
  className,
}: {
  data: DetailPanelData;
  onCollapse: () => void;
  /** Tombol tutup panel: viewer memindah fokus ke sini setelah panel dibuka lewat keyboard. */
  collapseRef?: Ref<HTMLButtonElement>;
  className?: string;
}) {
  const titleId = useId();
  const versionsId = useId();
  const { validation } = data;
  return (
    <section
      aria-labelledby={titleId}
      className={cn("flex w-70 flex-col rounded-xl border border-border-default bg-bg-panel", className)}
    >
      <header className="flex h-11 shrink-0 items-center justify-between py-2 pr-2 pl-4">
        <h2 id={titleId} className="text-label text-text-primary">
          {t.detailPanel.title}
        </h2>
        <IconButton
          size="sm"
          icon={PanelRight}
          label={t.detailPanel.collapse}
          // Di bawah, bukan di kiri: bayangan tooltip samping (blur 12, jarak 6) menutupi sisi cincin fokus.
          tooltipSide="bottom"
          ref={collapseRef}
          onClick={onCollapse}
        />
      </header>
      <Divider />
      <BudgetStats tier={data.tier} meters={data.meters} rows={data.rows} />
      <Divider />
      <section aria-labelledby={versionsId} className="flex flex-col gap-2 p-4">
        <h3 id={versionsId} className="text-overline text-text-tertiary uppercase">
          {t.versions.label}
        </h3>
        <VersionList versions={data.versions} value={data.version} onValueChange={data.onVersionChange} />
      </section>
      {data.optimization ? (
        <>
          <Divider />
          <Optimization rows={data.optimization} />
        </>
      ) : null}
      {validation === null ? null : (
        <>
          <Divider />
          <ValidationRow validation={validation} />
        </>
      )}
    </section>
  );
}

function ValidationRow({ validation }: { validation: ValidationSummary }) {
  const valid = validation.errors === 0;
  const errors = formatNumber(validation.errors);
  const warnings = formatNumber(validation.warnings);
  return (
    <p className="flex items-center gap-2 px-4 py-3 text-caption text-text-secondary">
      {valid ? (
        <CircleCheck aria-hidden="true" size={16} className="shrink-0 text-success-text" />
      ) : (
        <CircleAlert aria-hidden="true" size={16} className="shrink-0 text-danger-text" />
      )}
      {valid ? t.detailPanel.validation(errors, warnings) : t.detailPanel.validationFailed(errors, warnings)}
    </p>
  );
}
