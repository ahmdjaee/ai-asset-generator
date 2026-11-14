import { Plus, Trash2, Upload, X } from "lucide-react";
import { lazy, type ReactNode, Suspense, useId } from "react";
import { Streamdown } from "streamdown";
import { ThemeToggle } from "@/components/ThemeToggle.tsx";
import { Button } from "@/components/ui/button.tsx";
import { t, tSmoke } from "@/i18n/id.ts";
import { cn } from "@/lib/utils.ts";
import { type ProbeState, useRealtimeProbe } from "./useRealtimeProbe.ts";

// Kanvas 3D dimuat sebagai chunk terpisah, sama seperti viewer nanti (AGENTS.md §9).
const SmokeCanvas = lazy(async () => {
  const module = await import("./SmokeCanvas.tsx");
  return { default: module.SmokeCanvas };
});

function SmokeSection({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 id={headingId} className="text-title text-text-primary">
        {title}
      </h2>
      {children}
    </section>
  );
}

const PROBE_TONE: Record<ProbeState, string> = {
  connecting: "text-text-secondary",
  subscribing: "text-text-secondary",
  ok: "text-success-text",
  failed: "text-danger-text",
};

function RealtimeStatus() {
  const state = useRealtimeProbe();
  return (
    <p role="status" className={cn("text-body-strong", PROBE_TONE[state])}>
      {tSmoke.socketStatus[state]}
    </p>
  );
}

/** Halaman uji internal `/_smoke` (hanya mode dev dan tes). */
export function SmokePage() {
  const samples = tSmoke.buttonSamples;
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-10 px-8 py-10">
        <header className="flex flex-col gap-3">
          <h1 className="text-display text-text-primary">{tSmoke.title}</h1>
          <p className="text-body text-text-secondary">{tSmoke.description}</p>
          <ThemeToggle />
        </header>

        <SmokeSection title={tSmoke.buttons}>
          {(["md", "sm"] as const).map((size) => (
            <div key={size} className="flex flex-wrap items-center gap-3">
              <Button variant="primary" size={size} icon={Plus}>
                {samples.primary}
              </Button>
              <Button variant="secondary" size={size} icon={Upload}>
                {samples.secondary}
              </Button>
              <Button variant="ghost" size={size} icon={X}>
                {samples.ghost}
              </Button>
              <Button variant="danger" size={size} icon={Trash2}>
                {samples.danger}
              </Button>
              <Button variant="secondary" size={size} disabled>
                {samples.disabled}
              </Button>
            </div>
          ))}
        </SmokeSection>

        <SmokeSection title={tSmoke.markdown}>
          <div className="rounded-xl border border-border-default bg-bg-panel p-6 text-body text-text-primary">
            <Streamdown mode="static">{tSmoke.markdownSample}</Streamdown>
          </div>
        </SmokeSection>

        <SmokeSection title={tSmoke.canvas}>
          <Suspense
            fallback={
              <p role="status" className="text-small text-text-secondary">
                {t.loading}
              </p>
            }
          >
            <SmokeCanvas />
          </Suspense>
        </SmokeSection>

        <SmokeSection title={tSmoke.socket}>
          <RealtimeStatus />
        </SmokeSection>
      </div>
    </div>
  );
}
