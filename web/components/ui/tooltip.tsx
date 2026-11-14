import { Slot, Tooltip as TooltipPrimitive } from "radix-ui";
import type * as React from "react";
import { createContext, type RefObject, use, useEffect, useRef } from "react";
import { cn } from "@/lib/utils.ts";

type Interaction = "keyboard" | "pointer";

/**
 * Cara interaksi terakhir di app. `:focus-visible` tidak bisa dipakai untuk memutuskan tooltip saat fokus: Radix
 * memindahkan fokus lewat skrip saat menu dibuka atau ditutup dengan mouse, dan Chromium menganggap fokus skrip itu
 * `:focus-visible`. Pola sama dengan `useFocusVisible` React Aria. Tanpa provider: perilaku bawaan Radix.
 */
const LastInteraction = createContext<RefObject<Interaction>>({ current: "keyboard" });

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

/**
 * Satu provider untuk seluruh app (Radix mewajibkannya). Jeda buka 400 ms; desain tidak menentukan. Provider ini
 * juga mencatat interaksi terakhir (keyboard/pointer). Bawaannya pointer: fokus dari skrip sebelum ada interaksi
 * tidak membuka tooltip.
 */
export function TooltipProvider({ children }: { children: React.ReactNode }) {
  const interaction = useRef<Interaction>("pointer");
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Kombinasi sistem (Ctrl/Alt/Meta) dan tombol pengubah saja bukan navigasi keyboard di halaman.
      if (event.metaKey || event.ctrlKey || event.altKey || MODIFIER_KEYS.has(event.key)) return;
      interaction.current = "keyboard";
    };
    const onPointerDown = () => {
      interaction.current = "pointer";
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);
  return (
    <LastInteraction value={interaction}>
      <TooltipPrimitive.Provider delayDuration={400} skipDelayDuration={200}>
        {children}
      </TooltipPrimitive.Provider>
    </LastInteraction>
  );
}

/** Tombol pintasan di dalam tooltip: 18×18, `bg/active`, Caption Strong. */
function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex size-4.5 shrink-0 items-center justify-center rounded-sm bg-bg-active font-sans text-caption-strong text-text-secondary",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

type TooltipProps = {
  /** Teks tooltip (Caption). */
  label: string;
  /** Pintasan keyboard, mis. "W". */
  shortcut?: string;
  side?: "top" | "right" | "bottom" | "left";
  children: React.ReactElement;
};

/**
 * Meneruskan prop pemicu Radix ke anak, kecuali dua prop milik tooltip:
 * - `aria-describedby` yang menunjuk isi tooltip. Tooltip di app ini mengulang nama pemicu (`aria-label`); bila
 *   dijadikan deskripsi, pembaca layar membaca nama dua kali. Deskripsi milik anak sendiri tetap dipakai, karena prop
 *   anak menang atas prop Slot.
 * - `data-state` tooltip (`closed`/`delayed-open`/`instant-open`). Pemicu Radix di dalamnya (menu, dialog) menyebarkan
 *   prop yang diterimanya setelah `data-state` miliknya, jadi nilai tooltip menimpa `open` dan gaya terbukanya hilang.
 */
function TriggerSlot({
  "aria-describedby": _tooltipContent,
  "data-state": _tooltipState,
  ...props
}: React.ComponentProps<typeof Slot.Root> & { "data-state"?: string }) {
  return <Slot.Root {...props} />;
}

/**
 * Tooltip (FigCraft #1228): `bg/elevated`, garis `border/strong`, radius 6, padding 5/5/5/8, jarak 8.
 * Bayangan memakai token `shadow-color` (desain menulis rgba(0,0,0,.4) mentah; lihat Log keputusan Tahap 7).
 * Pemicu wajib punya nama sendiri yang sama dengan `label`; pintasan diumumkan lewat `aria-keyshortcuts` pemicu.
 * Terbuka saat hover, atau saat fokus bila interaksi terakhir dari keyboard. Fokus yang dikembalikan ke pemicu setelah
 * menu atau dialog ditutup dengan mouse tidak membukanya: Radix melewatkan pembukaan bila `onFocus` memanggil
 * `preventDefault`.
 */
export function Tooltip({ label, shortcut, side = "top", children }: TooltipProps) {
  const interaction = use(LastInteraction);
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger
        asChild
        onFocus={(event) => {
          if (interaction.current !== "keyboard") event.preventDefault();
        }}
      >
        <TriggerSlot>{children}</TriggerSlot>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            "z-50 flex items-center gap-2 rounded-md border border-border-strong bg-bg-elevated py-[5px] pr-[5px] pl-2",
            "text-caption text-text-primary shadow-[0_4px_12px_0_var(--color-shadow-color)]",
            "fade-in-0 zoom-in-95 animate-in data-[state=closed]:fade-out-0 data-[state=closed]:animate-out",
            !shortcut && "pr-2",
          )}
        >
          <span>{label}</span>
          {shortcut ? <Kbd>{shortcut}</Kbd> : null}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
