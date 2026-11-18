import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./menu.tsx";

export type DropdownOption<T extends string> = Readonly<{
  value: T;
  label: string;
  /** Nilai "kosong" (mis. "Tidak ada"): tampil `text/secondary` di pemicu. */
  muted?: boolean;
}>;

/**
 * Dropdown pilih satu (FigCraft Dropdown #572 + "A · Filter Tanggal" #4528). Pemicu: tinggi 32, `bg/raised`, garis
 * `border/default`, radius 8, padding 0/8/0/12, jarak 6; awalan Small `text/tertiary`, nilai Label `text/primary`,
 * `chevron-down` 16 `text/tertiary`. Hover dan terbuka tidak digambar: `bg/hover` seperti IconButton Secondary.
 * Isinya menu biasa (tidak modal) dengan centang di kiri item terpilih.
 *
 * Tanpa awalan (sel tabel budget Pengaturan, FigCraft layar 05): pemicu selebar sel, chevron di kanan, dan `label`
 * wajib diisi sebagai nama pemicu bagi pembaca layar (nilai terpilih ikut dibacakan).
 */
export function Dropdown<T extends string>({
  prefix,
  label,
  value,
  options,
  onValueChange,
  align = "start",
  className,
}: {
  /** Nama pilihan yang tampil di depan nilai, mis. "Tier". */
  prefix?: string;
  /** Nama untuk pembaca layar bila tanpa awalan, mis. "Normal map, Sedang". */
  label?: string;
  value: T;
  options: readonly DropdownOption<T>[];
  onValueChange: (value: T) => void;
  align?: "start" | "end";
  className?: string;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <Menu>
      <MenuTrigger
        {...(label === undefined ? {} : { "aria-label": `${label}: ${selected?.label ?? ""}` })}
        className={cn(
          "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border-default bg-bg-raised pr-2 pl-3 transition-colors",
          "hover:bg-bg-hover data-[state=open]:bg-bg-hover",
          prefix === undefined && "w-full min-w-0 justify-between",
          className,
        )}
      >
        {prefix === undefined ? null : (
          <span className="whitespace-nowrap text-small text-text-tertiary">{prefix}</span>
        )}
        <span
          className={cn(
            "truncate whitespace-nowrap text-label",
            selected?.muted === true ? "text-text-secondary" : "text-text-primary",
          )}
        >
          {selected?.label ?? ""}
        </span>
        <ChevronDown size={16} className="shrink-0 text-text-tertiary" />
      </MenuTrigger>
      <MenuContent align={align}>
        <MenuRadioGroup
          value={value}
          onValueChange={(next) => {
            const option = options.find((candidate) => candidate.value === next);
            if (option) onValueChange(option.value);
          }}
        >
          {options.map((option) => (
            <MenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}
