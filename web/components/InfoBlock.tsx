import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils.ts";

/** Blok info seperti kartu "Paling cocok / Masih terbatas" (FigCraft #894): ikon 16 + Label, isi Small. */
export function InfoBlock({
  icon: Glyph,
  tone,
  title,
  body,
}: {
  icon: LucideIcon;
  tone: string;
  title: string;
  body: string;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="flex items-center gap-2 text-label text-text-primary">
        <Glyph size={16} className={cn("shrink-0", tone)} />
        {title}
      </h3>
      <p className="text-small text-text-secondary">{body}</p>
    </section>
  );
}
