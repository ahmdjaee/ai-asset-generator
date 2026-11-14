import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type * as React from "react";
import { t } from "@/i18n/id.ts";
import { cn } from "@/lib/utils.ts";
import { IconButton } from "./icon-button.tsx";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Kandidat fokus awal: masuk urutan Tab, tidak nonaktif, tidak tersembunyi atau inert, bukan tombol tutup kepala. */
function initialFocusCandidates(content: HTMLElement): HTMLElement[] {
  return Array.from(content.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) =>
      element.dataset.dialogClose === undefined &&
      element.tabIndex >= 0 &&
      !element.matches(":disabled") &&
      !(element instanceof HTMLInputElement && element.type === "hidden") &&
      element.closest("[hidden], [inert]") === null,
  );
}

/**
 * Memfokuskan kandidat pertama yang benar-benar menerima fokus, atau wadah dialog bila tidak ada. Elemen yang
 * disembunyikan lewat CSS tidak terlihat dari atributnya; `focus()` padanya diam-diam gagal, jadi hasilnya dicek
 * (pola `focusFirst` Radix). Tanpa langkah ini fokus bisa tertinggal di luar dialog.
 */
function focusFirstControl(content: HTMLElement) {
  for (const candidate of initialFocusCandidates(content)) {
    candidate.focus();
    if (document.activeElement === candidate) return;
  }
  content.focus();
}

/**
 * Dialog (FigCraft #2837): lebar 440, `bg/elevated`, garis `border/default`, radius 12, bayangan token
 * `shadow-color` 0/8/24, padding 20, jarak 16. Kepala: judul Title + IconButton Ghost sm `x` (jarak 12, rata tengah);
 * isi Small `text/secondary`; aksi rata kanan. Latar belakang `overlay-scrim`.
 * Fokus awal jatuh ke kontrol pertama di isi dialog (bukan tombol tutup, supaya tooltip-nya tidak langsung muncul);
 * tanpa kontrol lain, fokus ke wadah dialog.
 */
export function DialogContent({
  title,
  description,
  children,
  className,
  onOpenAutoFocus,
  ...props
}: Omit<React.ComponentProps<typeof DialogPrimitive.Content>, "title"> & {
  title: string;
  description?: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-50 bg-overlay-scrim",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=open]:animate-in",
        )}
      />
      <DialogPrimitive.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-110 -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto",
          "rounded-xl border border-border-default bg-bg-elevated p-5 shadow-[0_8px_24px_0_var(--color-shadow-color)] outline-none",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=open]:animate-in",
          className,
        )}
        onOpenAutoFocus={(event) => {
          onOpenAutoFocus?.(event);
          if (event.defaultPrevented) return;
          event.preventDefault();
          // Event dikirim Radix ke wadah dialog itu sendiri, jadi `ref` milik pemanggil tetap utuh.
          if (event.target instanceof HTMLElement) focusFirstControl(event.target);
        }}
        {...(description === undefined ? { "aria-describedby": undefined } : {})}
        {...props}
      >
        <div className="flex items-center gap-3">
          <DialogPrimitive.Title className="min-w-0 flex-1 text-title text-text-primary">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close asChild>
            <IconButton icon={X} label={t.dialog.close} size="sm" data-dialog-close="" />
          </DialogPrimitive.Close>
        </div>
        {description === undefined ? null : (
          <DialogPrimitive.Description className="text-small text-text-secondary">
            {description}
          </DialogPrimitive.Description>
        )}
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Baris aksi dialog: rata kanan, jarak 8. */
export function DialogFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex items-center justify-end gap-2", className)}>{children}</div>;
}
