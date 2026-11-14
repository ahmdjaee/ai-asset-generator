import { CircleCheck, CircleHelp, TriangleAlert } from "lucide-react";
import { InfoBlock } from "@/components/InfoBlock.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog.tsx";
import { t } from "@/i18n/id.ts";

/**
 * Tombol "Panduan" di topbar Studio (Ghost sm, `circle-help`) dan dialognya. Isi dialog tidak digambar di FigCraft;
 * disusun dari Dialog dan teks kartu info desain (keputusan Tahap 7, lihat Log).
 */
export function GuideDialog() {
  const guide = t.guide;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" icon={CircleHelp}>
          {t.studio.guide}
        </Button>
      </DialogTrigger>
      <DialogContent title={guide.title} description={guide.description}>
        <section className="flex flex-col gap-2">
          <h3 className="text-label text-text-primary">{guide.stepsTitle}</h3>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-small text-text-secondary marker:text-text-tertiary">
            {guide.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
        <div className="flex flex-col gap-4 rounded-xl border border-border-default bg-bg-panel p-4">
          <InfoBlock icon={CircleCheck} tone="text-success-text" title={guide.goodTitle} body={guide.good} />
          <div aria-hidden className="h-px bg-border-default" />
          <InfoBlock
            icon={TriangleAlert}
            tone="text-warning-text"
            title={guide.limitedTitle}
            body={guide.limited}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
