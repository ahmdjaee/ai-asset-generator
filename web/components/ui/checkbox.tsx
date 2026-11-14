import { Check } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils.ts";

/**
 * Kotak centang (FigCraft frame "Tahap 10 · Gudang, detail, ekspor" F dan G): 20 × 20, radius 4. Belum dipilih:
 * `bg/raised` + garis `border/strong`. Terpilih: `accent/solid` dengan `check` 14 `on-accent`. Nonaktif: opacity
 * 45%. Fokus memakai cincin global, berjarak 1 px.
 */
export function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-sm border border-border-strong bg-bg-raised text-text-on-accent transition-colors",
        "focus-visible:outline-offset-1 data-[state=checked]:border-accent-solid data-[state=checked]:bg-accent-solid",
        "disabled:cursor-not-allowed disabled:opacity-45",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check size={14} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
