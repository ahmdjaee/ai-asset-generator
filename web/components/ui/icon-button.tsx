import { cva, type VariantProps } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils.ts";
import { Tooltip } from "./tooltip.tsx";

/**
 * IconButton (FigCraft #434): md 32×32 radius 8 ikon 18; sm 28×28 radius 6 ikon 16. Tanpa padding, ikon di tengah.
 * - Ghost: tanpa latar, ikon `text/secondary`.
 * - Secondary: `bg/raised` + garis 1 px `border/default`.
 * - Aktif (`active`): `bg/active`, ikon `text/primary` (toggle menyala, pilihan, rel di halaman Pengaturan).
 * Hover dan fokus tidak digambar: hover `bg/hover`, fokus cincin global `accent-ring` seperti Button.
 */
const iconButtonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center transition-colors",
    "disabled:pointer-events-none disabled:opacity-45",
  ],
  {
    variants: {
      variant: {
        ghost: "text-text-secondary hover:bg-bg-hover hover:text-text-primary",
        secondary:
          "border border-border-default bg-bg-raised text-text-secondary hover:bg-bg-hover hover:text-text-primary",
      },
      size: {
        md: "size-8 rounded-lg",
        sm: "size-7 rounded-md",
      },
      active: {
        true: "bg-bg-active text-text-primary hover:bg-bg-active",
        false: "",
      },
    },
    defaultVariants: { variant: "ghost", size: "md", active: false },
  },
);

const ICON_SIZE = { md: 18, sm: 16 } as const;

export type IconButtonProps = Omit<React.ComponentProps<"button">, "children"> &
  VariantProps<typeof iconButtonVariants> & {
    icon: LucideIcon;
    /** Nama yang dibaca pembaca layar sekaligus teks tooltip. */
    label: string;
    /** Pintasan keyboard: tampil di tooltip dan diumumkan lewat `aria-keyshortcuts`. */
    shortcut?: string;
    tooltipSide?: "top" | "right" | "bottom" | "left";
    /** Merender anak tunggal (mis. `<NavLink>`) dengan gaya ini; ikon dimasukkan ke dalamnya. */
    asChild?: boolean;
    children?: React.ReactElement;
  };

export function IconButton({
  icon: Glyph,
  label,
  shortcut,
  tooltipSide,
  variant,
  size,
  active,
  className,
  asChild = false,
  type,
  children,
  ...props
}: IconButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Tooltip label={label} side={tooltipSide} {...(shortcut ? { shortcut } : {})}>
      <Comp
        data-slot="icon-button"
        type={asChild ? type : (type ?? "button")}
        aria-label={label}
        aria-keyshortcuts={shortcut}
        className={cn(iconButtonVariants({ variant, size, active }), className)}
        {...props}
      >
        {asChild ? <Slot.Slottable>{children}</Slot.Slottable> : null}
        <Glyph size={ICON_SIZE[size ?? "md"]} className="shrink-0" />
      </Comp>
    </Tooltip>
  );
}
