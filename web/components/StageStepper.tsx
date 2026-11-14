import { Check } from "lucide-react";
import { t } from "@/i18n/id.ts";
import { cn } from "@/lib/utils.ts";

/** Posisi aset di dua tahap: belum mulai, bentuk dasar, aset final, selesai (FigCraft Stepper #529). */
export type StageProgress = "new" | "base" | "final" | "done";
type StepState = "upcoming" | "current" | "done";

const STEPS: Record<StageProgress, readonly [StepState, StepState]> = {
  new: ["upcoming", "upcoming"],
  base: ["current", "upcoming"],
  final: ["done", "current"],
  done: ["done", "done"],
};

const CIRCLE: Record<StepState, string> = {
  upcoming: "border-[1.5px] border-border-strong text-text-tertiary",
  current: "bg-accent-solid text-text-on-accent",
  done: "bg-success-soft text-success-text",
};

const LABEL: Record<StepState, string> = {
  upcoming: "text-text-tertiary",
  current: "text-text-primary",
  done: "text-text-secondary",
};

function Step({ number, label, state }: { number: number; label: string; state: StepState }) {
  return (
    <span className="flex items-center gap-2" aria-current={state === "current" ? "step" : undefined}>
      <span
        aria-hidden
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full text-caption-strong",
          CIRCLE[state],
        )}
      >
        {state === "done" ? <Check size={12} /> : number}
      </span>
      <span className={cn("whitespace-nowrap text-label", LABEL[state])}>
        {label}
        {state === "upcoming" ? null : (
          <span className="sr-only"> ({state === "done" ? t.stage.done : t.stage.current})</span>
        )}
      </span>
    </span>
  );
}

/**
 * Indikator tahap "1 Bentuk dasar — 2 Aset final": lingkaran 20, jarak 8, label Label; penghubung 32×1
 * `border/strong` dengan jarak 10.
 */
export function StageStepper({ stage, className }: { stage: StageProgress; className?: string }) {
  const [first, second] = STEPS[stage];
  return (
    <ol aria-label={t.stage.label} className={cn("flex items-center gap-2.5", className)}>
      <li>
        <Step number={1} label={t.stage.base} state={first} />
      </li>
      <li className="flex items-center gap-2.5">
        <span aria-hidden className="h-px w-8 bg-border-strong" />
        <Step number={2} label={t.stage.final} state={second} />
      </li>
    </ol>
  );
}
