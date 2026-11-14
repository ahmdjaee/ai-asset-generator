import { CircleAlert, CircleCheck, Info, type LucideIcon, X } from "lucide-react";
import type { CSSProperties } from "react";
import { Toaster as Sonner, toast } from "sonner";
import { t } from "@/i18n/id.ts";
import { cn } from "@/lib/utils.ts";
import { IconButton } from "./icon-button.tsx";

export type ToastKind = "success" | "error" | "info";

const KIND: Record<ToastKind, { icon: LucideIcon; tone: string }> = {
  success: { icon: CircleCheck, tone: "text-success-text" },
  error: { icon: CircleAlert, tone: "text-danger-text" },
  info: { icon: Info, tone: "text-text-secondary" },
};

/**
 * Toast (FigCraft #2953): lebar 360, `bg/elevated`, garis `border/strong`, radius 8, bayangan token `shadow-color`
 * 0/8/24, padding 12, jarak 10. Ikon 16 dan tombol tutup (IconButton Ghost sm) duduk di slot setinggi baris judul
 * (18 px); tombol 28 px menonjol 5 px ke atas dan bawah. Judul Label, deskripsi Caption `text/secondary`, jarak 2.
 * Kartu tidak memakai `role` status/alert: wilayah sonner sudah `aria-live="polite"`, dan live region bersarang
 * membuat pembaca layar bisa mengumumkan toast dua kali.
 */
export function ToastCard({
  kind,
  title,
  description,
  onClose,
  className,
}: {
  kind: ToastKind;
  title: string;
  description?: string;
  onClose: () => void;
  className?: string;
}) {
  const { icon: Glyph, tone } = KIND[kind];
  return (
    <div
      className={cn(
        "flex w-90 items-start gap-2.5 rounded-lg border border-border-strong bg-bg-elevated p-3 shadow-[0_8px_24px_0_var(--color-shadow-color)]",
        className,
      )}
    >
      <Glyph size={16} className={cn("mt-px shrink-0", tone)} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-label text-text-primary">{title}</p>
        {description ? <p className="text-caption text-text-secondary">{description}</p> : null}
      </div>
      <IconButton icon={X} label={t.toast.close} size="sm" className="-my-[5px]" onClick={onClose} />
    </div>
  );
}

/** Wadah toast (sonner): kanan bawah, jarak 16 dari tepi. Satu di root app. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      offset={16}
      gap={8}
      visibleToasts={4}
      containerAriaLabel={t.toast.region}
      toastOptions={{ unstyled: true }}
      style={{ "--width": "360px" } as CSSProperties}
    />
  );
}

export type NotifyOptions = Readonly<{
  /** Id tetap: toast dengan id sama diganti, dan bisa ditutup lewat `notify.dismiss(id)`. */
  id?: string;
}>;

function show(kind: ToastKind, title: string, description?: string, options: NotifyOptions = {}) {
  const { id } = options;
  return toast.custom(
    (toastId) => (
      <ToastCard
        kind={kind}
        title={title}
        {...(description === undefined ? {} : { description })}
        onClose={() => toast.dismiss(toastId)}
      />
    ),
    { duration: kind === "error" ? 8000 : 5000, ...(id === undefined ? {} : { id }) },
  );
}

/** Menampilkan toast sesuai desain. Pesan diambil dari `web/i18n/id.ts` oleh pemanggil. */
export const notify = {
  success: (title: string, description?: string, options?: NotifyOptions) =>
    show("success", title, description, options),
  error: (title: string, description?: string, options?: NotifyOptions) =>
    show("error", title, description, options),
  info: (title: string, description?: string, options?: NotifyOptions) =>
    show("info", title, description, options),
  dismiss: (id: string) => {
    toast.dismiss(id);
  },
};
