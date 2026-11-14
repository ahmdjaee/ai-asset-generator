import { ProgressSteps } from "@/components/ProgressSteps.tsx";
import { useNow } from "@/lib/clock.tsx";
import type { BuildTimings } from "../../../shared/version-report.ts";
import { buildProgress } from "./build-progress.ts";
import type { BuildBlock } from "./thread-items.ts";
import type { LiveBuild } from "./thread-store.ts";

/** Kartu progres satu build di thread; lama berjalan diperbarui tiap detik selama build berjalan. */
export function BuildCard({
  block,
  live,
  timings,
  nextVersion,
}: {
  block: BuildBlock;
  live: LiveBuild | undefined;
  timings: BuildTimings | null;
  nextVersion: number | null;
}) {
  const now = useNow(block.status === "running");
  const view = buildProgress({ block, live, timings, nextVersion, now });
  return <ProgressSteps title={view.title} meta={view.meta} steps={view.steps} />;
}
