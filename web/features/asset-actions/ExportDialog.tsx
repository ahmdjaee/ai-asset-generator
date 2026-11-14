import { useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog.tsx";
import { Dropdown } from "@/components/ui/dropdown.tsx";
import { RadioCards } from "@/components/ui/radio-cards.tsx";
import { notify } from "@/components/ui/toast.tsx";
import { t } from "@/i18n/id.ts";
import { toApiError } from "@/lib/api.ts";
import { exportUrl } from "@/lib/asset-urls.ts";
import { saveBlob } from "@/lib/download.ts";
import { EXPORT_PRESETS, type ExportPreset, exportFileName } from "../../../shared/export.ts";
import { formatBytes } from "../../../shared/format.ts";
import { useAssetDetail } from "../studio/queries.ts";
import { exportEstimateKey, useExportEstimate } from "./queries.ts";

export type ExportVersion = Readonly<{ n: number; stage: "base" | "textured" }>;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Info kanan kartu format: ukuran pasti, "≈ ukuran" (perkiraan), atau status estimasi. */
function presetMeta(estimate: ReturnType<typeof useExportEstimate>, preset: ExportPreset): string {
  const { exportDialog } = t.assetActions;
  if (estimate.isPending) return exportDialog.estimating;
  const item = estimate.data?.presets.find((candidate) => candidate.preset === preset);
  if (item === undefined) return exportDialog.estimateFailed;
  return item.exact ? formatBytes(item.bytes) : exportDialog.estimate(formatBytes(item.bytes));
}

function ExportForm({
  assetId,
  assetName,
  initialVersion,
  open,
  onDone,
}: {
  assetId: string;
  assetName: string;
  initialVersion: number;
  /** Dialog masih terbuka. Isi dialog tetap terpasang selama animasi tutup, jadi pembatalan mengikuti nilai ini. */
  open: boolean;
  onDone: () => void;
}) {
  const formatId = useId();
  const detail = useAssetDetail(assetId);
  const [version, setVersion] = useState(initialVersion);
  const [preset, setPreset] = useState<ExportPreset>("web");
  const [downloading, setDownloading] = useState(false);
  const estimate = useExportEstimate(assetId, version);
  const client = useQueryClient();
  const controller = useRef<AbortController | null>(null);
  const { exportDialog } = t.assetActions;

  // Dialog ditutup saat unduhan masih disiapkan: permintaan dibatalkan, tidak ada file yang disimpan. Ditutup berarti
  // `open` false (animasi tutup masih berjalan) atau isi dialog dilepas.
  useEffect(() => {
    if (!open) controller.current?.abort();
  }, [open]);
  useEffect(() => () => controller.current?.abort(), []);

  const versions: readonly ExportVersion[] = detail.data?.versions ?? [{ n: initialVersion, stage: "base" }];
  const known = detail.data !== undefined;
  const fileName = exportFileName(assetName, version, preset);

  const download = async () => {
    const abort = new AbortController();
    controller.current = abort;
    setDownloading(true);
    try {
      const response = await fetch(exportUrl(assetId, version, preset), { signal: abort.signal });
      if (!response.ok) throw await toApiError(response);
      const blob = await response.blob();
      // File ekspor kini ada di `derived/`: ukuran perkiraan (≈) menjadi pasti saat dialog dibuka lagi.
      void client.invalidateQueries({ queryKey: exportEstimateKey(assetId, version) });
      if (abort.signal.aborted) {
        // Ditutup saat isi respons sudah terbaca: file tetap tidak disimpan.
        setDownloading(false);
        return;
      }
      saveBlob(blob, fileName);
      onDone();
    } catch (error) {
      // Dialog bisa dibuka lagi selama animasi tutup: tombol Unduh tidak tertinggal dalam keadaan memuat.
      setDownloading(false);
      if (!abort.signal.aborted) notify.error(t.assetActions.exportDialog.failed, message(error));
    }
  };

  return (
    <>
      {known ? (
        <Dropdown
          prefix={exportDialog.version}
          value={String(version)}
          options={[...versions]
            .sort((a, b) => b.n - a.n)
            .map((item) => ({
              value: String(item.n),
              label: t.session.versionTitle(item.n, item.stage === "textured"),
            }))}
          onValueChange={(next) => setVersion(Number(next))}
          className="self-start"
        />
      ) : null}
      <div className="flex flex-col gap-2">
        <h3 id={formatId} className="text-label text-text-primary">
          {exportDialog.format}
        </h3>
        <RadioCards
          labelledBy={formatId}
          value={preset}
          onValueChange={setPreset}
          options={EXPORT_PRESETS.map((value) => ({
            value,
            title: exportDialog.presets[value].title,
            description: exportDialog.presets[value].description,
            meta: presetMeta(estimate, value),
          }))}
        />
      </div>
      <p className="text-caption text-text-tertiary">{exportDialog.fileName(fileName)}</p>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">{exportDialog.cancel}</Button>
        </DialogClose>
        <Button variant="primary" icon={Download} loading={downloading} onClick={() => void download()}>
          {exportDialog.download}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Dialog "Ekspor aset" (frame Tahap 10 C #4712): pilih versi (Dropdown), format (kartu Web / Unity / Sumber dengan
 * ukuran; "≈" = perkiraan karena file belum pernah dibuat), nama file, lalu Batal + Unduh. File dibuat server saat
 * pertama diminta (di-cache di `derived/`), jadi Unduh menunggu responsnya sambil memuat lalu menyimpan file.
 */
export function ExportDialog({
  open,
  onOpenChange,
  assetId,
  assetName,
  version,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assetId: string;
  assetName: string;
  /** Versi yang terpilih saat dialog dibuka (versi yang sedang dilihat, atau versi terkini). */
  version: number;
  /** Fokus setelah dialog ditutup (dialog ini tidak punya `Dialog.Trigger`). */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const { exportDialog } = t.assetActions;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={exportDialog.title}
        description={exportDialog.description}
        {...(onCloseAutoFocus === undefined ? {} : { onCloseAutoFocus })}
      >
        <ExportForm
          assetId={assetId}
          assetName={assetName}
          initialVersion={version}
          open={open}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
