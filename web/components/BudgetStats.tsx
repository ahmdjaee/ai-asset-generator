import { Meter, type MeterTone } from "@/components/ui/meter.tsx";
import { t } from "@/i18n/id.ts";
import { cn } from "@/lib/utils.ts";
import type { TierId } from "../../shared/limits.ts";
import { TierIndicator } from "./Tier.tsx";

export type BudgetMeter = { label: string; valueText: string; ratio: number; tone?: MeterTone };
export type StatRow = { label: string; value: string };

/**
 * Statistik + meter budget (FigCraft Panel detail → Statistik #1244): judul Overline "Anggaran tier" + Tier,
 * dua meter, lalu baris detail (kunci Caption `text/tertiary`, nilai Caption `text/secondary` angka tabular).
 * Padding 16, jarak 14.
 */
export function BudgetStats({
  tier,
  meters,
  rows,
  className,
}: {
  tier: TierId;
  meters: readonly BudgetMeter[];
  rows: readonly StatRow[];
  className?: string;
}) {
  return (
    <section aria-label={t.budget.title} className={cn("flex flex-col gap-3.5 p-4", className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-overline text-text-tertiary uppercase">{t.budget.title}</h3>
        <TierIndicator tier={tier} className="text-text-secondary" />
      </div>
      {meters.map((meter) => (
        <Meter key={meter.label} {...meter} />
      ))}
      <dl className="flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start justify-between gap-3">
            <dt className="text-caption text-text-tertiary">{row.label}</dt>
            <dd className="text-right text-caption text-text-secondary tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
