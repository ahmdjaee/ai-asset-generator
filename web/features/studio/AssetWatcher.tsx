import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useMatch } from "react-router";
import { notify } from "@/components/ui/toast.tsx";
import { t } from "@/i18n/id.ts";
import { assetsKey, mergeBuildProgress, useAssets } from "@/lib/assets.ts";
import { useRealtime } from "@/lib/realtime-context.tsx";
import type { AssetStatus } from "../../../shared/asset.ts";
import { assetKey, markAssetDeleted } from "./queries.ts";

const REVIEW_STATUSES: ReadonlySet<AssetStatus> = new Set(["BASE_REVIEW", "TEXTURE_REVIEW"]);

type Summary = Readonly<{ id: string; name: string; status: AssetStatus }>;

type StatusToast = Readonly<{ kind: "review" | "done"; assetId: string; name: string }>;

/** Id toast status per aset: toast baru untuk aset yang sama menggantikan yang lama. */
export function statusToastId(assetId: string): string {
  return `aset-status:${assetId}`;
}

/**
 * Toast untuk aset lain yang berubah tahap: siap direview atau selesai. Aset yang sedang dibuka tidak diberi toast
 * (dock-nya sudah menampilkan kartu). `null` = daftar pertama, belum ada pembanding.
 */
export function statusToasts(
  before: ReadonlyMap<string, AssetStatus> | null,
  assets: readonly Summary[],
  viewing: string | null,
): StatusToast[] {
  if (before === null) return [];
  const toasts: StatusToast[] = [];
  for (const asset of assets) {
    const previous = before.get(asset.id);
    if (previous === undefined || previous === asset.status || asset.id === viewing) continue;
    if (asset.status === "DONE") toasts.push({ kind: "done", assetId: asset.id, name: asset.name });
    else if (REVIEW_STATUSES.has(asset.status))
      toasts.push({ kind: "review", assetId: asset.id, name: asset.name });
  }
  return toasts;
}

/**
 * Penyimak perubahan aset untuk seluruh app: topik `global` menyegarkan daftar aset dan detail aset yang berubah (aset
 * yang dihapus hanya ditandai, tanpa mengambil detailnya yang pasti 404), progres build digabung ke daftar di cache,
 * dan aset lain yang siap direview atau selesai diberi toast.
 */
export function useAssetWatcher(): void {
  const client = useQueryClient();
  const realtime = useRealtime();
  const assets = useAssets();
  const viewing = useMatch("/studio/:assetId")?.params.assetId ?? null;
  const statuses = useRef<ReadonlyMap<string, AssetStatus> | null>(null);

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
    for (const toast of statusToasts(statuses.current, assets.data, viewing)) {
      const options = { id: statusToastId(toast.assetId) };
      if (toast.kind === "done") notify.success(t.session.finished(toast.name), undefined, options);
      else notify.info(t.session.needsReview(toast.name), undefined, options);
    }
    statuses.current = new Map(assets.data.map((asset) => [asset.id, asset.status]));
  }, [assets.data, viewing]);

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
