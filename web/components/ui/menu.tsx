import { Check, type LucideIcon } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils.ts";

/**
 * Menu tidak modal (pola menu button APG): konten di luar menu tidak diberi `aria-hidden` dan tidak dikunci. Menu
 * modal Radix menyembunyikan seluruh app dari pembaca layar padahal app masih berisi elemen yang bisa difokus (axe
 * `aria-hidden-focus`, serius). Escape dan klik di luar menutup menu; klik di luar tetap sampai ke sasarannya. Tab
 * di dalam menu tidak memindahkan fokus (perilaku Radix untuk semua menu).
 */
export function Menu({ modal = false, ...props }: React.ComponentProps<typeof DropdownMenu.Root>) {
  return <DropdownMenu.Root modal={modal} {...props} />;
}
export const MenuTrigger = DropdownMenu.Trigger;
export const MenuRadioGroup = DropdownMenu.RadioGroup;

/**
 * Menu (FigCraft Menu sudut #2559 + "Menu (umum)" #3070): wadah `bg/elevated`, garis `border/default`, radius 10,
 * padding 4, bayangan token `shadow-color`. Item 32 px, padding 8/10, jarak 8, radius 6, hover `bg/hover`.
 * Pemisah: garis 1 px `border/strong` dengan jarak 4 di atas dan bawah.
 */
export function MenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "z-50 min-w-50 rounded-[10px] border border-border-default bg-bg-elevated p-1 shadow-[0_8px_24px_0_var(--color-shadow-color)] outline-none",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=open]:animate-in",
          className,
        )}
        {...props}
      />
    </DropdownMenu.Portal>
  );
}

const ITEM = [
  "flex h-8 cursor-default select-none items-center gap-2 rounded-md pr-2.5 pl-2 text-small text-text-primary outline-none",
  "data-highlighted:bg-bg-hover data-disabled:pointer-events-none data-disabled:opacity-45",
];

export function MenuItem({
  icon: Glyph,
  hint,
  danger = false,
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenu.Item> & {
  icon?: LucideIcon;
  /** Teks kecil di kanan, mis. pintasan. */
  hint?: string;
  /** Aksi berbahaya: ikon dan label `danger/text`. */
  danger?: boolean;
}) {
  return (
    <DropdownMenu.Item className={cn(ITEM, danger && "text-danger-text", className)} {...props}>
      {Glyph ? <Glyph size={16} className={cn("shrink-0", danger ? "" : "text-text-secondary")} /> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className="text-caption text-text-tertiary">{hint}</span> : null}
    </DropdownMenu.Item>
  );
}

/** Item pilihan dengan slot centang di kiri (Menu sudut): centang `accent/text` hanya pada item terpilih. */
export function MenuRadioItem({
  hint,
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenu.RadioItem> & { hint?: string }) {
  return (
    <DropdownMenu.RadioItem className={cn(ITEM, className)} {...props}>
      <span className="flex size-4 shrink-0 items-center justify-center">
        <DropdownMenu.ItemIndicator>
          <Check size={16} className="text-accent-text" />
        </DropdownMenu.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className="text-caption text-text-tertiary">{hint}</span> : null}
    </DropdownMenu.RadioItem>
  );
}

export function MenuSeparator({ className }: { className?: string }) {
  return <DropdownMenu.Separator className={cn("my-1 h-px bg-border-strong", className)} />;
}

export function MenuLabel({ className, ...props }: React.ComponentProps<typeof DropdownMenu.Label>) {
  return <DropdownMenu.Label className={cn("text-text-primary", className)} {...props} />;
}
