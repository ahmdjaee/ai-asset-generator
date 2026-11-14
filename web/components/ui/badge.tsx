import { cn } from "@/lib/utils.ts";

/** Nada Badge = mode koleksi Status di FigCraft. */
export type BadgeTone = "neutral" | "accent" | "warning" | "success" | "danger";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-bg-active text-text-secondary",
  accent: "bg-accent-soft text-accent-text",
  warning: "bg-warning-soft text-warning-text",
  success: "bg-success-soft text-success-text",
  danger: "bg-danger-soft text-danger-text",
};

/**
 * Badge status (FigCraft #483): tinggi 22, padding 8, jarak 6, radius 6; titik 6×6 dan label Caption Strong
 * berwarna `status/fg`, latar `status/bg`.
 */
export function Badge({
  tone,
  children,
  className,
}: {
  tone: BadgeTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5.5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-caption-strong",
        TONES[tone],
        className,
      )}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      {children}
    </span>
  );
}
