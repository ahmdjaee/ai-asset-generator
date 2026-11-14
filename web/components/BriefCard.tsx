import { t } from "@/i18n/id.ts";
import type { Brief } from "../../shared/brief.ts";
import { formatNumber } from "../../shared/format.ts";

/**
 * Ringkasan brief (FigCraft #1084): kotak `bg/raised` + garis `border/default`, radius 10, padding 12, jarak 6; Overline,
 * lalu baris kunci Caption `text/tertiary` (lebar 64, jarak 12) dan nilai Caption `text/primary`. Dipakai thread Studio
 * dan panel info Detail aset.
 */
export function BriefCard({ brief, headingLevel = 3 }: { brief: Brief; headingLevel?: 2 | 3 }) {
  const cm = (meters: number) => formatNumber(meters * 100, 1);
  const rows: Array<[string, string]> = [
    [t.thread.brief.category, `${brief.category} · ${brief.style}`],
    [
      t.thread.brief.size,
      t.thread.brief.sizeValue(
        cm(brief.dimensionsM.width),
        cm(brief.dimensionsM.depth),
        cm(brief.dimensionsM.height),
      ),
    ],
    ...(brief.notes === undefined || brief.notes === ""
      ? []
      : [[t.thread.brief.notes, brief.notes] satisfies [string, string]]),
  ];
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section
      aria-label={t.thread.brief.title}
      className="flex flex-col gap-1.5 rounded-[10px] border border-border-default bg-bg-raised p-3"
    >
      <Heading className="text-overline text-text-tertiary uppercase">{t.thread.brief.title}</Heading>
      <dl className="flex flex-col gap-1.5">
        {rows.map(([key, value]) => (
          <div key={key} className="flex gap-3 text-caption">
            <dt className="w-16 shrink-0 text-text-tertiary">{key}</dt>
            <dd className="min-w-0 flex-1 break-words text-text-primary">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
