import { type ReactNode, useId } from "react";
import { cn } from "@/lib/utils.ts";

/**
 * Kartu bagian Pengaturan (FigCraft layar 05 "Bagian · …"): `bg/raised`, garis `border/default`, radius 8, padding 20,
 * jarak 16. Kepala: judul Body Strong `text/primary` + keterangan Small `text/secondary`, jarak 4.
 */
export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-lg border border-border-default bg-bg-raised p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-body-strong text-text-primary">
          {title}
        </h2>
        {description === undefined ? null : <p className="text-small text-text-secondary">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * Baris pengaturan (FigCraft "Tier bawaan", "Tema", "Notifikasi"): teks di kiri (Label `text/primary` + Caption
 * `text/secondary`, jarak 2), kontrol di kanan, jarak 16. `divided`: garis atas `border/default` + padding atas 16.
 */
export function SettingRow({
  label,
  labelId,
  description,
  descriptionId,
  divided = false,
  children,
}: {
  label: string;
  labelId?: string;
  description: string;
  descriptionId?: string;
  divided?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4",
        divided && "border-border-default border-t pt-4",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p id={labelId} className="text-label text-text-primary">
          {label}
        </p>
        <p id={descriptionId} className="text-caption text-text-secondary">
          {description}
        </p>
      </div>
      {children}
    </div>
  );
}

/** Catatan kecil di bawah bagian: Caption `text/tertiary`. */
export function SectionNote({ children }: { children: ReactNode }) {
  return <p className="text-caption text-text-tertiary">{children}</p>;
}
