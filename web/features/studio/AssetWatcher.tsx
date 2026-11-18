import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useMatch, useNavigate } from "react-router";
import { notify } from "@/components/ui/toast.tsx";
import { t } from "@/i18n/id.ts";
import { assetsKey, mergeBuildProgress, useAssets } from "@/lib/assets.ts";
import { showBackgroundNotification } from "@/lib/notifications.ts";
import { useRealtime } from "@/lib/realtime-context.tsx";
import type { AssetStatus, RunState } from "../../../shared/asset.ts";
import { assetKey, markAssetDeleted } from "./queries.ts";

const REVIEW_STATUSES: ReadonlySet<AssetStatus> = new Set(["BASE_REVIEW", "TEXTURE_REVIEW"]);

type Snapshot = Readonly<{ status: AssetStatus; runState: RunState }>;
type Summary = Snapshot & Readonly<{ id: string; name: string }>;

export type AssetChange = Readonly<{
  kind: "review" | "done" | "failed" | "question";
  assetId: string;
  name: string;
}>;

/** Id toast status per aset: toast baru untuk aset yang sama menggantikan yang lama. */
export function statusToastId(assetId: string): string {
  return `aset-status:${assetId}`;
}

function changeKind(previous: Snapshot, asset: Summary): AssetChange["kind"] | null {
  if (previous.status !== asset.status) {
    if (asset.status === "DONE") return "done";
    if (REVIEW_STATUSES.has(asset.status)) return "review";
  }
  if (previous.runState !== asset.runState) {
    if (asset.runState === "failed") return "failed";
    if (asset.runState === "waiting_user") return "question";
  }
  return null;
}

/**
 * Aset yang perlu perhatian pemilik sejak daftar sebelumnya: siap direview, selesai, prosesnya gagal, atau Claude
 * menunggu jawaban. `null` = daftar pertama, belum ada pembanding. Aset baru (belum ada di daftar lama) dilewati.
 */
export function assetChanges(
  before: ReadonlyMap<string, Snapshot> | null,
  assets: readonly Summary[],
): AssetChange[] {
  if (before === null) return [];
  const changes: AssetChange[] = [];
  for (const asset of assets) {
    const previous = before.get(asset.id);
    if (previous === undefined) continue;
    const kind = changeKind(previous, asset);
    if (kind !== null) changes.push({ kind, assetId: asset.id, name: asset.name });
  }
  return changes;
}

/** Toast untuk aset lain; aset yang sedang dibuka tidak diberi toast (dock-nya sudah menampilkan kartu). */
export function statusToasts(
  before: ReadonlyMap<string, Snapshot> | null,
  assets: readonly Summary[],
  viewing: string | null,
): AssetChange[] {
  return assetChanges(before, assets).filter((change) => change.assetId !== viewing);
}

const TOAST_TITLE: Record<AssetChange["kind"], (name: string) => string> = {
  review: t.session.needsReview,
  done: t.session.finished,
  failed: t.session.failed,
  question: t.session.needsAnswer,
};

function showToast(change: AssetChange): void {
  const title = TOAST_TITLE[change.kind](change.name);
  const options = { id: statusToastId(change.assetId) };
  if (change.kind === "done") notify.success(title, undefined, options);
  else if (change.kind === "failed") notify.error(title, undefined, options);
  else notify.info(title, undefined, options);
}

/**
 * Penyimak perubahan aset untuk seluruh app: topik `global` menyegarkan daftar aset dan detail aset yang berubah (aset
 * yang dihapus hanya ditandai, tanpa mengambil detailnya yang pasti 404), progres build digabung ke daftar di cache,
 * dan aset yang perlu perhatian diberi toast (aset lain) serta notifikasi browser (tab tidak sedang dilihat).
 */
export function useAssetWatcher(): void {
  const client = useQueryClient();
  const realtime = useRealtime();
  const assets = useAssets();
  const viewing = useMatch("/studio/:assetId")?.params.assetId ?? null;
  const navigate = useNavigate();
  const statuses = useRef<ReadonlyMap<string, Snapshot> | null>(null);

  useEffect(
    () =>
      realtime.subscribe(
        "global",
        (event) => {
          if (event.type === "asset_progress") {
            mergeBuildProgress(client, event.assetId, { stage: event.stage, pct: event.pct });
            return;
          }
          if (event.type !== "asset") return;
          void client.invalidateQueries({ queryKey: assetsKey });
          if (event.change === "deleted") markAssetDeleted(client, event.assetId);
          else if (event.change !== "created")
            void client.invalidateQueries({ queryKey: assetKey(event.assetId) });
        },
        // Topik global tidak di-replay: setelah (sambung ulang) terpasang, daftar diambil ulang.
        { onReady: () => void client.invalidateQueries({ queryKey: assetsKey }) },
      ),
    [client, realtime],
  );

  useEffect(() => {
    if (assets.data === undefined) return;
    const changes = assetChanges(statuses.current, assets.data);
    for (const change of changes) {
      if (change.assetId !== viewing) showToast(change);
      // Tab tidak sedang dilihat: notifikasi browser (bila diizinkan), juga untuk aset yang sedang dibuka.
      showBackgroundNotification(TOAST_TITLE[change.kind](change.name), {
        body: t.session.notificationBody,
        tag: statusToastId(change.assetId),
        onClick: () => void navigate(`/studio/${encodeURIComponent(change.assetId)}`),
      });
    }
    statuses.current = new Map(
      assets.data.map((asset) => [asset.id, { status: asset.status, runState: asset.runState }]),
    );
  }, [assets.data, viewing, navigate]);

  // Aset yang dibuka tidak butuh toast lagi. Aset baru bisa selesai dibangun sebelum navigasi ke sesinya selesai,
  // sehingga toast-nya sempat tampil.
  useEffect(() => {
    if (viewing !== null) notify.dismiss(statusToastId(viewing));
  }, [viewing]);
}

/**
 * Penyimak sebagai komponen tanpa tampilan, supaya perubahan daftar aset hanya merender ulang komponen ini, bukan
 * seluruh kerangka app.
 */
export function AssetWatcher(): null {
  useAssetWatcher();
  return null;
}
