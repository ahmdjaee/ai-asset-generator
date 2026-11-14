import { Circle, CircleAlert, CircleCheck, LoaderCircle, type LucideIcon, Square } from "lucide-react";
import { useId, useState } from "react";
import { t } from "@/i18n/id.ts";
import { cn } from "@/lib/utils.ts";

export type StepStatus = "done" | "running" | "pending" | "failed" | "stopped";

export type ProgressStep = {
  id: string;
  label: string;
  status: StepStatus;
  /** Durasi yang sudah lewat, mis. "12 dtk". */
  duration?: string;
};

const STEP_ICON: Record<StepStatus, { icon: LucideIcon; tone: string; label: string }> = {
  done: { icon: CircleCheck, tone: "text-success-text", label: "text-text-secondary" },
  running: { icon: LoaderCircle, tone: "text-accent-text", label: "text-text-primary" },
  pending: { icon: Circle, tone: "text-text-tertiary", label: "text-text-tertiary" },
  failed: { icon: CircleAlert, tone: "text-danger-text", label: "text-text-primary" },
  // FigCraft Langkah "Status=Dihentikan" #3839: square 14 `text/tertiary`, label `text/secondary`.
  stopped: { icon: Square, tone: "text-text-tertiary", label: "text-text-secondary" },
};

/**
 * Status keseluruhan: gagal bila ada langkah gagal; dihentikan bila ada langkah dihentikan (langkah sesudahnya tidak
 * akan jalan); berjalan bila ada langkah berjalan atau masih menunggu (di antara dua langkah tidak ada yang berjalan);
 * selain itu selesai.
 */
function overall(steps: readonly ProgressStep[]): StepStatus {
  if (steps.some((step) => step.status === "failed")) return "failed";
  if (steps.some((step) => step.status === "stopped")) return "stopped";
  if (steps.some((step) => step.status === "running" || step.status === "pending")) return "running";
  return "done";
}

/** Terbuka secara bawaan selama ada yang perlu diikuti (berjalan) atau dibaca (gagal). */
const OPEN_BY_DEFAULT: Readonly<Record<StepStatus, boolean>> = {
  running: true,
  pending: true,
  failed: true,
  done: false,
  stopped: false,
};

/**
 * Langkah progres (FigCraft ringkasan #1095 + "Langkah progres (terbuka)" #3175): garis `border/default`, radius 8.
 * Padding 8/12/8/10, jarak 4: kepala (ikon 16 + judul Small + keterangan Caption) lalu langkah 28 px berikon 14.
 * Saat berjalan atau gagal daftar terbuka; setelah selesai atau dihentikan tertutup. Kepala adalah tombol
 * `aria-expanded` untuk membuka dan menutup daftar (desain tidak menggambar chevron, jadi tidak ada chevron).
 */
export function ProgressSteps({
  title,
  meta,
  steps,
  className,
}: {
  title: string;
  /** Mis. "4 langkah · 1 mnt 48 dtk". */
  meta?: string;
  steps: readonly ProgressStep[];
  className?: string;
}) {
  const state = overall(steps);
  // Pilihan buka/tutup pengguna hanya berlaku selama status keseluruhan sama. Saat status berubah pilihan dibuang
  // (pola React "menyesuaikan state saat render"), sehingga kembali ke bawaan (`OPEN_BY_DEFAULT`).
  const [choice, setChoice] = useState<{ state: StepStatus; open: boolean } | null>(null);
  if (choice !== null && choice.state !== state) setChoice(null);
  const expanded = choice !== null && choice.state === state ? choice.open : OPEN_BY_DEFAULT[state];
  const listId = useId();
  const head = STEP_ICON[state];
  const HeadIcon = head.icon;
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-lg border border-border-default py-2 pr-3 pl-2.5",
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setChoice({ state, open: !expanded })}
        className="flex w-full items-center gap-2 rounded-sm text-left"
      >
        <HeadIcon size={16} className={cn("shrink-0", head.tone, state === "running" && "animate-spin")} />
        <span className="min-w-0 flex-1 truncate text-small text-text-primary">{title}</span>
        {meta ? <span className="shrink-0 text-caption text-text-tertiary tabular-nums">{meta}</span> : null}
        <span className="sr-only">{t.progress.toggle}</span>
      </button>
      <ol id={listId} hidden={!expanded} className="flex flex-col">
        {steps.map((step) => {
          const look = STEP_ICON[step.status];
          const StepIcon = look.icon;
          return (
            <li key={step.id} className="flex h-7 items-center gap-2 pl-1">
              <StepIcon
                size={14}
                className={cn("shrink-0", look.tone, step.status === "running" && "animate-spin")}
              />
              <span className={cn("min-w-0 flex-1 truncate text-small", look.label)}>
                {step.label}
                <span className="sr-only"> ({t.progress.state[step.status]})</span>
              </span>
              {step.duration ? (
                <span className="shrink-0 text-caption text-text-tertiary tabular-nums">{step.duration}</span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
