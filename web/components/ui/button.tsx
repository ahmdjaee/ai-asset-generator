import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle, type LucideIcon } from "lucide-react";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils.ts";

/**
 * Button (FigCraft #385, Type × Size). Ikon di depan label; ukurannya mengikuti ukuran tombol (md 16, sm 14).
 * State yang tidak digambar di set utama mengikuti frame "Tahap 7 · komponen tambahan":
 * - nonaktif: seluruh tombol opacity 45% (preseden segmen "Tekstur (nonaktif)");
 * - memuat: ikon diganti `loader-circle` berputar, tombol tetap fokus (`aria-disabled`) dan `aria-busy`;
 * - fokus: cincin 2 px `accent-ring` berjarak 2 px dari aturan global `:focus-visible` (`web/styles/globals.css`).
 * Hover tidak digambar: memakai token `accent/solid-hover` dan `bg/hover`.
 */
const buttonVariants = cva(
  [
    "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap transition-colors",
    "disabled:pointer-events-none disabled:opacity-45 aria-busy:cursor-progress",
  ],
  {
    variants: {
      variant: {
        primary: "bg-accent-solid text-text-on-accent hover:bg-accent-solid-hover",
        secondary: "border border-border-strong bg-bg-raised text-text-primary hover:bg-bg-hover",
        ghost: "text-text-secondary hover:bg-bg-hover hover:text-text-primary",
        danger: "bg-danger-soft text-danger-text hover:opacity-90",
      },
      size: {
        md: "h-9 gap-2 rounded-lg px-3.5 text-body-strong",
        sm: "h-7.5 gap-1.5 rounded-md px-2.5 text-label",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

const ICON_SIZE = { md: 16, sm: 14 } as const;

/** Tombol yang mengaktifkan kontrol atau membuka pemicu Radix (menu, select) dari keyboard. */
const ACTIVATION_KEYS = new Set(["Enter", " ", "ArrowDown", "ArrowUp"]);

function stopActivation(event: React.SyntheticEvent) {
  event.preventDefault();
  event.stopPropagation();
}

/**
 * Penahan aktivasi saat memuat. Dipasang di fase capture, jadi berjalan sebelum `onClick` anak `asChild` (mis. `<Link>`)
 * dan sebelum `onPointerDown`/`onKeyDown` pemicu Radix yang membungkus tombol ini. `pointerdown` tidak di-`preventDefault`
 * supaya fokus tetap bisa pindah ke tombol.
 */
const BUSY_HANDLERS = {
  onClickCapture: stopActivation,
  onPointerDownCapture: (event: React.PointerEvent) => event.stopPropagation(),
  onKeyDownCapture: (event: React.KeyboardEvent) => {
    if (ACTIVATION_KEYS.has(event.key)) stopActivation(event);
  },
};

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** Merender anak tunggal (misalnya `<Link>`) dengan gaya tombol. */
    asChild?: boolean;
    /** Ikon Lucide di depan label. */
    icon?: LucideIcon;
    /** Sedang memproses: ikon berputar, klik diabaikan, fokus tetap di tombol. */
    loading?: boolean;
  };

export function Button({
  className,
  variant,
  size,
  asChild = false,
  type,
  icon,
  loading = false,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  const Glyph = loading ? LoaderCircle : icon;
  const iconSize = ICON_SIZE[size ?? "md"];
  return (
    <Comp
      data-slot="button"
      // Bawaan HTML adalah "submit"; tombol biasa tidak boleh mengirim form tanpa sengaja.
      type={asChild ? type : (type ?? "button")}
      className={cn(buttonVariants({ variant, size }), className)}
      aria-busy={loading || undefined}
      aria-disabled={loading || props["aria-disabled"]}
      {...props}
      {...(loading ? BUSY_HANDLERS : {})}
    >
      {Glyph ? <Glyph size={iconSize} className={cn("shrink-0", loading && "animate-spin")} /> : null}
      <Slot.Slottable>{children}</Slot.Slottable>
    </Comp>
  );
}

export { buttonVariants };
