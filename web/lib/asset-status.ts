/**
 * Status aset untuk tampilan: Badge (FigCraft set Status #483) dan indikator tahap topbar. Dipakai Studio dan (Tahap
 * 10) Gudang supaya satu aset selalu tampil dengan status yang sama.
 */
import type { StageProgress } from "@/components/StageStepper.tsx";
import type { BadgeTone } from "@/components/ui/badge.tsx";
import { t } from "@/i18n/id.ts";
import type { AssetStatus, RunState } from "../../shared/asset.ts";

const TEXTURE_STAGE: ReadonlySet<AssetStatus> = new Set(["TEXTURE_WORKING", "TEXTURE_REVIEW"]);

/**
 * Prioritas: gagal → Claude bekerja (termasuk menunggu jawaban) → selesai → perlu review → tahap yang sedang
 * dikerjakan tanpa proses berjalan (netral, nama tahapnya).
 */
export function assetBadge(asset: Readonly<{ status: AssetStatus; runState: RunState }>): Readonly<{
  tone: BadgeTone;
  label: string;
}> {
  if (asset.runState === "failed") return { tone: "danger", label: t.status.failed };
  if (asset.runState === "running" || asset.runState === "waiting_user") {
    return { tone: "accent", label: t.status.working };
  }
  if (asset.status === "DONE") return { tone: "success", label: t.status.done };
  if (asset.status === "BASE_REVIEW" || asset.status === "TEXTURE_REVIEW") {
    return { tone: "warning", label: t.status.review };
  }
  return { tone: "neutral", label: TEXTURE_STAGE.has(asset.status) ? t.stage.final : t.status.base };
}

/** Indikator tahap topbar: bentuk dasar, aset final, atau keduanya selesai. */
export function stageProgress(status: AssetStatus): StageProgress {
  if (status === "DONE") return "done";
  return TEXTURE_STAGE.has(status) ? "final" : "base";
}
