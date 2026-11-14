import { RadioGroup } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils.ts";
import { Tooltip } from "./tooltip.tsx";

export type SegmentedOption<T extends string> = {
  value: T;
  /** Isi tombol; teksnya menjadi nama pilihan bagi pembaca layar. */
  label: React.ReactNode;
  /** Pilihan berupa ikon saja: nama untuk pembaca layar (`aria-label`) sekaligus teks tooltip. */
  name?: string;
  /** Pilihan tidak bisa dipilih (mis. mode Tekstur sebelum aset bertekstur); panah keyboard melewatinya. */
  disabled?: boolean;
};

const rootVariants = {
  track: "rounded-lg border border-border-default bg-bg-sunken p-[3px]",
  toolbar: "",
  icons: "rounded-lg border border-border-default bg-bg-sunken p-0.5",
} as const;

const itemVariants = {
  track: [
    "gap-1.5 px-2.5 text-text-tertiary hover:text-text-secondary",
    "data-[state=checked]:bg-bg-elevated data-[state=checked]:text-text-primary",
    "data-[state=checked]:shadow-[inset_0_0_0_1px_var(--color-border-strong)]",
  ],
  toolbar: [
    "px-2.5 text-label text-text-secondary hover:bg-bg-hover hover:text-text-primary",
    "data-[state=checked]:bg-bg-active data-[state=checked]:text-text-primary data-[state=checked]:hover:bg-bg-active",
  ],
  icons: [
    "w-7 justify-center text-text-secondary hover:bg-bg-hover hover:text-text-primary",
    "data-[state=checked]:bg-bg-active data-[state=checked]:text-text-primary data-[state=checked]:hover:bg-bg-active",
  ],
} as const;

/**
 * Kontrol segmen (FigCraft Segmented tier #596 dan Toggle tema): grup radio dengan panah kiri/kanan.
 * - Trek: `bg/sunken`, garis `border/default`, radius 8, padding 3, jarak 2.
 * - Pilihan: tinggi 28, padding-x 10, radius 6; terpilih `bg/elevated` + garis `border/strong`.
 * Garis pilihan digambar sebagai bayangan inset supaya lebar pilihan tidak berubah saat berganti
 * (desain menggambar garis 1 px yang menambah 2 px; lihat Log keputusan Tahap 7).
 *
 * Varian `toolbar` (FigCraft Toolbar viewport → Mode shading #1153): tanpa trek, jarak 2; pilihan Label
 * `text/secondary`, terpilih `bg/active` + `text/primary`, nonaktif opasitas 0,45.
 *
 * Varian `icons` (FigCraft layar 03 "Tampilan" #1375): trek `bg/sunken` + garis `border/default`, radius 8, padding 2,
 * jarak 2; pilihan IconButton sm 28 × 28 (ikon 16), terpilih `bg/active`. Setiap pilihan wajib punya `name`.
 */
export function Segmented<T extends string>({
  label,
  value,
  onValueChange,
  options,
  variant = "track",
  className,
}: {
  /** Nama grup untuk pembaca layar. */
  label: string;
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  variant?: keyof typeof rootVariants;
  className?: string;
}) {
  return (
    <RadioGroup.Root
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        const option = options.find((item) => item.value === next);
        if (option) onValueChange(option.value);
      }}
      orientation="horizontal"
      className={cn("inline-flex w-fit items-center gap-0.5", rootVariants[variant], className)}
    >
      {options.map((option) => (
        <SegmentedItem key={option.value} option={option} variant={variant} />
      ))}
    </RadioGroup.Root>
  );
}

function SegmentedItem<T extends string>({
  option,
  variant,
}: {
  option: SegmentedOption<T>;
  variant: keyof typeof itemVariants;
}) {
  const item = (
    <RadioGroup.Item
      value={option.value}
      disabled={option.disabled ?? false}
      {...(option.name === undefined ? {} : { "aria-label": option.name })}
      className={cn(
        "inline-flex h-7 items-center rounded-md transition-colors focus-visible:outline-offset-1",
        "disabled:pointer-events-none disabled:opacity-45",
        itemVariants[variant],
      )}
    >
      {option.label}
    </RadioGroup.Item>
  );
  return option.name === undefined ? (
    item
  ) : (
    <Tooltip label={option.name} side="bottom">
      {item}
    </Tooltip>
  );
}
