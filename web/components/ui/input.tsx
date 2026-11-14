import type * as React from "react";
import { cn } from "@/lib/utils.ts";

/**
 * Field input (FigCraft "Tahap 7 · komponen tambahan", dari Search #577): tinggi 32, padding-x 10, `bg/raised`,
 * garis `border/default`, radius 8, teks Small; placeholder `text/tertiary`.
 * Fokus: garis `accent-ring` + cincin global 2 px (`:focus-visible`, juga saat diklik). Error (`aria-invalid`): garis
 * `danger/text`. Nonaktif: opacity 45%.
 */
const FIELD = [
  "w-full min-w-0 rounded-lg border border-border-default bg-bg-raised text-text-primary transition-colors",
  "placeholder:text-text-tertiary focus-visible:border-accent-ring",
  "aria-invalid:border-danger-text disabled:cursor-not-allowed disabled:opacity-45",
];

export function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return <input type={type} className={cn(FIELD, "h-8 px-2.5 text-small", className)} {...props} />;
}

/** Textarea: sama dengan Input, tinggi minimal 88, padding 10, teks Body. */
export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(FIELD, "min-h-22 resize-y p-2.5 text-body", className)} {...props} />;
}

export type FieldControlProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  disabled?: true;
};

/**
 * Field (FigCraft #2826): label Label + kontrol + teks bantuan/error Caption, jarak 6. Kontrol menerima `id`,
 * atribut ARIA, dan `disabled` lewat render prop, supaya label dan pesan error selalu tersambung.
 * Nonaktif: seluruh field opacity 45% (label dan teks bantuan di sini, kontrol lewat `disabled:` miliknya).
 */
export function Field({
  id,
  label,
  description,
  error,
  disabled = false,
  className,
  children,
}: {
  id: string;
  label: string;
  description?: string;
  error?: string;
  disabled?: boolean;
  className?: string;
  children: (control: FieldControlProps) => React.ReactNode;
}) {
  const helpId = `${id}-bantuan`;
  const help = error ?? description;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className={cn("text-label text-text-primary", disabled && "opacity-45")}>
        {label}
      </label>
      {children({
        id,
        ...(help === undefined ? {} : { "aria-describedby": helpId }),
        ...(error === undefined ? {} : { "aria-invalid": true }),
        ...(disabled ? { disabled: true } : {}),
      })}
      {help === undefined ? null : (
        <p
          id={helpId}
          className={cn("text-caption", error === undefined ? "text-text-tertiary" : "text-danger-text")}
        >
          {help}
        </p>
      )}
    </div>
  );
}
