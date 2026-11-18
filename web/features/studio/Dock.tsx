import {
  Check,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Cuboid,
  Download,
  LoaderCircle,
  type LucideIcon,
  Palette,
  Pencil,
  RotateCcw,
  Square,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button.tsx";
import { t } from "@/i18n/id.ts";
import { useNow } from "@/lib/clock.tsx";
import { cn } from "@/lib/utils.ts";
import type { AssetStatus, RunState } from "../../../shared/asset.ts";
import { formatDuration } from "../../../shared/format.ts";

export type DockState =
  | Readonly<{ kind: "working"; stage: "base" | "textured"; nextVersion: number }>
  | Readonly<{ kind: "waiting" }>
  | Readonly<{ kind: "baseReview"; version: number }>
  | Readonly<{ kind: "finalReview"; version: number }>
  | Readonly<{ kind: "done"; version: number }>
  | Readonly<{ kind: "failed" }>
  | Readonly<{ kind: "interrupted" }>
  | Readonly<{ kind: "none" }>;

const TEXTURE_STATUSES: ReadonlySet<AssetStatus> = new Set(["TEXTURE_WORKING", "TEXTURE_REVIEW", "DONE"]);

/**
 * Kartu dock dari keadaan aset.
 * - Claude bekerja atau menunggu jawaban: kartu proses atau kartu menunggu.
 * - Selain itu kartu review dan selesai mengikuti status, juga bila giliran gagal atau terputus setelah versi dikirim
 *   (mis. batas pemakaian, server berhenti): server tetap menerima Setujui dan Selesai.
 * - Tahap yang masih dikerjakan (juga tanpa versi) setelah giliran gagal: kartu "Coba lagi"; setelah server berhenti
 *   di tengah giliran: kartu "Lanjutkan" (frame Tahap 11 C2). Penyebabnya dijelaskan di thread.
 * - Selain itu hanya composer.
 */
export function dockState(
  asset: Readonly<{ status: AssetStatus; runState: RunState; currentVersion: number | null }>,
  latestVersion: number | null,
): DockState {
  if (asset.runState === "running") {
    return {
      kind: "working",
      stage: TEXTURE_STATUSES.has(asset.status) ? "textured" : "base",
      nextVersion: (latestVersion ?? 0) + 1,
    };
  }
  if (asset.runState === "waiting_user") return { kind: "waiting" };
  const version = asset.currentVersion;
  if (version !== null) {
    if (asset.status === "BASE_REVIEW") return { kind: "baseReview", version };
    if (asset.status === "TEXTURE_REVIEW") return { kind: "finalReview", version };
    if (asset.status === "DONE") return { kind: "done", version };
  }
  if (asset.runState === "failed") return { kind: "failed" };
  if (asset.runState === "interrupted") return { kind: "interrupted" };
  return { kind: "none" };
}

/** Judul kartu dock untuk live region (pembaca layar); tanpa kartu tidak ada yang diumumkan. */
export function dockAnnouncement(state: DockState): string {
  switch (state.kind) {
    case "working":
      return t.dock.working.title;
    case "waiting":
      return t.dock.waiting.title;
    case "baseReview":
      return t.dock.baseReview.title(`v${state.version}`);
    case "finalReview":
      return t.dock.finalReview.title(`v${state.version}`);
    case "done":
      return t.dock.done.title(`v${state.version}`);
    case "failed":
      return t.dock.failed.title;
    case "interrupted":
      return t.dock.interrupted.title;
    case "none":
      return "";
  }
}

const TONES = {
  accent: "bg-accent-soft text-accent-text",
  warning: "bg-warning-soft text-warning-text",
  success: "bg-success-soft text-success-text",
  danger: "bg-danger-soft text-danger-text",
} as const;

/**
 * Kartu dock (FigCraft "Kartu persetujuan" #1104 dan "Kartu dock" #3847): `bg/raised`, radius 12. Kepala: ubin ikon
 * 28 radius 8 + judul Label dan keterangan Caption `text/secondary` (jarak 2), jarak 10.
 * - Kartu proses: padding 12, garis `border/default`, kepala rata tengah dengan tombol Stop di kanan.
 * - Kartu review: padding 14, garis `border/strong`, aksi di bawah kepala (jarak 12).
 */
function DockCard({
  tone,
  icon: Glyph,
  spin = false,
  title,
  description,
  compact = false,
  strong = false,
  trailing,
  children,
}: {
  tone: keyof typeof TONES;
  icon: LucideIcon;
  spin?: boolean;
  title: string;
  description: string;
  compact?: boolean;
  strong?: boolean;
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-bg-raised",
        compact ? "p-3" : "p-3.5",
        strong ? "border-border-strong" : "border-border-default",
      )}
    >
      <div className={cn("flex gap-2.5", compact ? "items-center" : "items-start")}>
        <span
          aria-hidden
          className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", TONES[tone])}
        >
          <Glyph size={16} className={spin ? "motion-safe:animate-spin" : undefined} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="text-label text-text-primary">{title}</h2>
          <p className="text-caption text-text-secondary">{description}</p>
        </div>
        {trailing}
      </div>
      {children}
    </section>
  );
}

function WorkingCard({
  state,
  since,
  stopping,
  onStop,
}: {
  state: Extract<DockState, { kind: "working" }>;
  since: number;
  stopping: boolean;
  onStop: () => void;
}) {
  const now = useNow(true);
  const stage = `${t.build.stageTitle[state.stage]} v${state.nextVersion}`;
  return (
    <DockCard
      compact
      tone="accent"
      icon={LoaderCircle}
      spin
      title={t.dock.working.title}
      description={t.dock.working.meta(stage, formatDuration(now - since))}
      trailing={<StopButton stopping={stopping} onStop={onStop} />}
    />
  );
}

function StopButton({ stopping, onStop }: { stopping: boolean; onStop: () => void }) {
  return (
    <Button variant="secondary" size="sm" icon={Square} loading={stopping} onClick={onStop}>
      {t.dock.stop}
    </Button>
  );
}

export const DOCK_PENDING = ["stop", "approve", "finish", "retry", "resume"] as const;
export type DockPending = (typeof DOCK_PENDING)[number];

export type DockActions = Readonly<{
  stop: () => void;
  approve: () => void;
  finish: () => void;
  revise: () => void;
  changeShape: () => void;
  retry: () => void;
  resume: () => void;
  /** Aksi yang sedang dikirim ke server (tombolnya menampilkan state memuat). */
  pending: DockPending | null;
}>;

/**
 * Dock percakapan (FigCraft Dock #1103): garis atas `border/default`, `bg/panel`, padding 12/16/16/16, jarak 12.
 * Kartu sesuai keadaan aset, lalu composer.
 */
export function Dock({
  state,
  workingSince,
  downloadUrl,
  downloadName,
  actions,
  composer,
}: {
  state: DockState;
  /** Awal giliran Claude yang sedang berjalan (pesan atau aksi pemilik terakhir). */
  workingSince: number;
  downloadUrl: string | null;
  downloadName: string;
  actions: DockActions;
  composer: ReactNode;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-3 border-border-default border-t bg-bg-panel px-4 pt-3 pb-4">
      <DockCardFor
        state={state}
        workingSince={workingSince}
        downloadUrl={downloadUrl}
        downloadName={downloadName}
        actions={actions}
      />
      {composer}
    </div>
  );
}

function DockCardFor({
  state,
  workingSince,
  downloadUrl,
  downloadName,
  actions,
}: {
  state: DockState;
  workingSince: number;
  downloadUrl: string | null;
  downloadName: string;
  actions: DockActions;
}): ReactNode {
  const { dock } = t;
  switch (state.kind) {
    case "none":
      return null;
    case "working":
      return (
        <WorkingCard
          state={state}
          since={workingSince}
          stopping={actions.pending === "stop"}
          onStop={actions.stop}
        />
      );
    case "waiting":
      return (
        <DockCard
          compact
          tone="accent"
          icon={CircleHelp}
          title={dock.waiting.title}
          description={dock.waiting.description}
          trailing={<StopButton stopping={actions.pending === "stop"} onStop={actions.stop} />}
        />
      );
    case "failed":
      return (
        <DockCard
          compact
          tone="danger"
          icon={CircleAlert}
          title={dock.failed.title}
          description={dock.failed.description}
          trailing={
            <Button
              variant="secondary"
              size="sm"
              icon={RotateCcw}
              loading={actions.pending === "retry"}
              onClick={actions.retry}
            >
              {dock.failed.retry}
            </Button>
          }
        />
      );
    case "interrupted":
      return (
        <DockCard
          compact
          tone="warning"
          icon={TriangleAlert}
          title={dock.interrupted.title}
          description={dock.interrupted.description}
          trailing={
            <Button
              variant="secondary"
              size="sm"
              icon={RotateCcw}
              loading={actions.pending === "resume"}
              onClick={actions.resume}
            >
              {dock.interrupted.resume}
            </Button>
          }
        />
      );
    case "baseReview":
      return (
        <DockCard
          strong
          tone="warning"
          icon={Cuboid}
          title={dock.baseReview.title(`v${state.version}`)}
          description={dock.baseReview.description}
        >
          <div className="flex gap-2">
            <Button
              variant="primary"
              icon={Check}
              className="min-w-0 flex-1"
              loading={actions.pending === "approve"}
              onClick={actions.approve}
            >
              {dock.baseReview.approve}
            </Button>
            <Button variant="secondary" icon={Pencil} onClick={actions.revise}>
              {dock.revise}
            </Button>
          </div>
        </DockCard>
      );
    case "finalReview":
      return (
        <DockCard
          strong
          tone="warning"
          icon={Palette}
          title={dock.finalReview.title(`v${state.version}`)}
          description={dock.finalReview.description}
        >
          <div className="flex gap-2">
            <Button
              variant="primary"
              icon={Check}
              className="min-w-0 flex-1"
              loading={actions.pending === "finish"}
              onClick={actions.finish}
            >
              {dock.finalReview.finish}
            </Button>
            <Button variant="secondary" icon={Pencil} onClick={actions.revise}>
              {dock.revise}
            </Button>
          </div>
          <div className="flex">
            <Button variant="ghost" size="sm" icon={RotateCcw} onClick={actions.changeShape}>
              {dock.finalReview.changeShape}
            </Button>
          </div>
        </DockCard>
      );
    case "done":
      return (
        <DockCard
          tone="success"
          icon={CircleCheck}
          title={dock.done.title(`v${state.version}`)}
          description={dock.done.description}
        >
          {downloadUrl === null ? null : (
            <Button asChild variant="primary" icon={Download} className="w-full">
              <a href={downloadUrl} download={downloadName}>
                {dock.done.download}
              </a>
            </Button>
          )}
        </DockCard>
      );
  }
}
