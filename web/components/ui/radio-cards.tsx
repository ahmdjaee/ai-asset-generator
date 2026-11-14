import { Circle, CircleDot } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { useId } from "react";
import { cn } from "@/lib/utils.ts";

export type RadioCardOption<T extends string> = Readonly<{
  value: T;
  title: string;
  description: string;
  /** Info di kanan, mis. ukuran file. Ikut diumumkan sebagai keterangan pilihan. */
  meta?: string;
}>;

/**
 * Pilihan berbentuk kartu (FigCraft Dialog ekspor, bagian Format #4744): grup radio vertikal, jarak 8. Kartu radius
 * 8, padding 10/12/10/10, jarak 10. Ikon radio 16: `circle` `text/tertiary`, terpilih `circle-dot` `accent/text`.
 * Nama Label `text/primary`, keterangan Caption `text/secondary` (jarak 2), info kanan Small `text/secondary`.
 * Belum dipilih: garis `border/strong`, hover `bg/hover`; terpilih: latar `accent/soft` + garis `accent/solid`.
 */
export function RadioCards<T extends string>({
  labelledBy,
  value,
  options,
  onValueChange,
  className,
}: {
  /** Id elemen judul grup (`aria-labelledby`). */
  labelledBy: string;
  value: T;
  options: readonly RadioCardOption<T>[];
  onValueChange: (value: T) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <RadioGroup.Root
      aria-labelledby={labelledBy}
      value={value}
      onValueChange={(next) => {
        const option = options.find((item) => item.value === next);
        if (option) onValueChange(option.value);
      }}
      orientation="vertical"
      className={cn("flex flex-col gap-2", className)}
    >
      {options.map((option) => {
        const titleId = `${id}-${option.value}-nama`;
        const detailId = `${id}-${option.value}-keterangan`;
        const metaId = `${id}-${option.value}-info`;
        const checked = option.value === value;
        const Glyph = checked ? CircleDot : Circle;
        return (
          <RadioGroup.Item
            key={option.value}
            value={option.value}
            aria-labelledby={titleId}
            aria-describedby={option.meta === undefined ? detailId : `${detailId} ${metaId}`}
            className={cn(
              "flex w-full items-start gap-2.5 rounded-lg border border-border-strong py-2.5 pr-3 pl-2.5 text-left transition-colors",
              "hover:bg-bg-hover focus-visible:outline-offset-1",
              "data-[state=checked]:border-accent-solid data-[state=checked]:bg-accent-soft",
            )}
          >
            <Glyph
              size={16}
              className={cn("mt-px shrink-0", checked ? "text-accent-text" : "text-text-tertiary")}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span id={titleId} className="text-label text-text-primary">
                {option.title}
              </span>
              <span id={detailId} className="text-caption text-text-secondary">
                {option.description}
              </span>
            </span>
            {option.meta === undefined ? null : (
              <span id={metaId} className="shrink-0 text-small text-text-secondary tabular-nums">
                {option.meta}
              </span>
            )}
          </RadioGroup.Item>
        );
      })}
    </RadioGroup.Root>
  );
}
