import { useId } from "react";
import { cn } from "@/lib/utils.ts";

/** Nada meter budget: normal, mendekati batas (melewati target), melewati batas maksimal. */
export type MeterTone = "normal" | "warning" | "danger";

/**
 * Warna isi untuk Chromium (`::-webkit-meter-optimum-value`) dan Firefox (`::-moz-meter-bar`). Gaya bawaan Chromium
 * memakai gradien hijau di `background-image`, jadi `bg-none` di bawah wajib supaya warna token terlihat.
 */
const FILL: Record<MeterTone, string> = {
  normal: "[&::-moz-meter-bar]:bg-accent-solid [&::-webkit-meter-optimum-value]:bg-accent-solid",
  warning: "[&::-moz-meter-bar]:bg-warning-text [&::-webkit-meter-optimum-value]:bg-warning-text",
  danger: "[&::-moz-meter-bar]:bg-danger-text [&::-webkit-meter-optimum-value]:bg-danger-text",
};

/**
 * Meter budget (FigCraft Statistik #1244 + "Meter anggaran" di frame Tahap 7): baris label Small `text/secondary`
 * dan nilai Small angka tabular, lalu trek 4 px `bg/active` dengan isi sesuai rasio. Elemen `<meter>` asli supaya
 * pembaca layar mengenalnya tanpa ARIA tambahan.
 */
export function Meter({
  label,
  valueText,
  ratio,
  tone = "normal",
  className,
}: {
  label: string;
  /** Nilai yang tampil, mis. "3.388 / 8.000". Juga dibacakan sebagai `aria-valuetext`. */
  valueText: string;
  /** Isi trek, 0..1 (lebih dari 1 dipotong penuh). */
  ratio: number;
  tone?: MeterTone;
  className?: string;
}) {
  const labelId = useId();
  const clamped = Math.min(Math.max(ratio, 0), 1);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-3">
        <span id={labelId} className="text-small text-text-secondary">
          {label}
        </span>
        <span
          className={cn(
            "text-small tabular-nums",
            tone === "danger" ? "text-danger-text" : "text-text-primary",
          )}
        >
          {valueText}
        </span>
      </div>
      <meter
        aria-labelledby={labelId}
        aria-valuetext={valueText}
        min={0}
        max={1}
        value={clamped}
        className={cn(
          "block h-1 w-full appearance-none overflow-hidden rounded-full border-0 bg-bg-active",
          "[&::-webkit-meter-bar]:h-1 [&::-webkit-meter-bar]:rounded-full [&::-webkit-meter-bar]:border-0 [&::-webkit-meter-bar]:bg-bg-active [&::-webkit-meter-bar]:bg-none",
          "[&::-webkit-meter-optimum-value]:rounded-full [&::-webkit-meter-optimum-value]:bg-none [&::-moz-meter-bar]:rounded-full [&::-moz-meter-bar]:bg-none",
          FILL[tone],
        )}
      />
    </div>
  );
}
