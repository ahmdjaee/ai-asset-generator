import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils.ts";

/**
 * Empty state (frame Tahap 7): kolom tengah lebar 360, jarak 12. Ubin ikon 40×40 radius 8 `bg/raised` + garis
 * `border/default` dengan ikon 20 `text/tertiary`; judul Heading; isi Small `text/secondary`; aksi opsional.
 */
export function EmptyState({
  icon: Glyph,
  title,
  description,
  action,
  headingLevel = 2,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  headingLevel?: 1 | 2 | 3;
  className?: string;
}) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div className={cn("mx-auto flex w-full max-w-90 flex-col items-center gap-3 text-center", className)}>
      <span className="flex size-10 items-center justify-center rounded-lg border border-border-default bg-bg-raised text-text-tertiary">
        <Glyph size={20} />
      </span>
      <Heading className="text-heading text-text-primary">{title}</Heading>
      <p className="text-small text-text-secondary">{description}</p>
      {action}
    </div>
  );
}
