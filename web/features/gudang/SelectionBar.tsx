import { Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { notify } from "@/components/ui/toast.tsx";
import { t } from "@/i18n/id.ts";
import { exportZipUrl } from "@/lib/asset-urls.ts";
import { downloadUrl } from "@/lib/download.ts";
import { ZIP_PRESETS, type ZipPreset } from "../../../shared/export.ts";
import { formatNumber } from "../../../shared/format.ts";
import { EXPORT_ZIP_MAX_ASSETS } from "../../../shared/limits.ts";
import { usePrepareZip } from "../asset-actions/queries.ts";

const ZIP_LABEL: Readonly<Record<ZipPreset, string>> = {
  web: t.gudang.select.zipWeb,
  unity: t.gudang.select.zipUnity,
};

function Divider() {
  return <span aria-hidden className="h-5 w-px shrink-0 bg-border-strong" />;
}

/**
 * Bar mode pilih (FigCraft #4845): `bg/elevated`, garis `border/default`, radius 12, bayangan 0/8/24 `shadow/color`,
 * padding 8/8/8/16, jarak 8. "N aset dipilih" (Label, diumumkan), Pilih semua, ZIP Web dan ZIP Unity (Secondary sm),
 * Batal. Letaknya tidak digambar: melayang di tengah bawah area konten.
 * ZIP nonaktif bila belum ada yang dipilih atau melebihi `EXPORT_ZIP_MAX_ASSETS`; keterangan batasnya (tidak digambar)
 * tampil di samping jumlah dan ikut diumumkan. Klik ZIP: server memeriksa aset dan menyiapkan GLB Unity lebih dulu
 * (tombol memuat), lalu unduhan di-stream ke file lewat tautan; kesalahan pemeriksaan tampil sebagai toast.
 */
export function SelectionBar({
  selectedIds,
  onSelectAll,
  onCancel,
}: {
  /** Aset terpilih yang tampil dan punya versi, dalam urutan daftar. */
  selectedIds: readonly string[];
  onSelectAll: () => void;
  onCancel: () => void;
}) {
  const { select } = t.gudang;
  const count = selectedIds.length;
  const tooMany = count > EXPORT_ZIP_MAX_ASSETS;
  const ready = count > 0 && !tooMany;
  const prepare = usePrepareZip();
  const [pending, setPending] = useState<ZipPreset | null>(null);
  // Bar ditutup (Batal) saat pemeriksaan masih berjalan: unduhan tidak dimulai lagi setelahnya.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const download = async (preset: ZipPreset) => {
    if (pending !== null) return;
    const ids = [...selectedIds];
    setPending(preset);
    try {
      await prepare.mutateAsync({ ids, preset });
      if (mounted.current) downloadUrl(exportZipUrl(ids, preset));
    } catch (error) {
      if (mounted.current)
        notify.error(select.zipFailed, error instanceof Error ? error.message : String(error));
    } finally {
      if (mounted.current) setPending(null);
    }
  };
  return (
    <section
      aria-label={select.bar}
      className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-border-default bg-bg-elevated py-2 pr-2 pl-4 shadow-[0_8px_24px_0_var(--color-shadow-color)]"
    >
      <p role="status" className="flex items-baseline gap-2 whitespace-nowrap">
        <span className="text-label text-text-primary">{select.count(formatNumber(count))}</span>
        {tooMany ? (
          <span className="text-caption text-warning-text">
            {select.limit(formatNumber(EXPORT_ZIP_MAX_ASSETS))}
          </span>
        ) : null}
      </p>
      {/* Tidak pernah nonaktif: tombol yang tiba-tiba nonaktif melempar fokus keyboard keluar dari bar. */}
      <Button variant="ghost" size="sm" onClick={onSelectAll}>
        {select.all}
      </Button>
      <Divider />
      {ZIP_PRESETS.map((preset) => (
        <Button
          key={preset}
          variant="secondary"
          size="sm"
          icon={Download}
          disabled={!ready}
          loading={pending === preset}
          onClick={() => void download(preset)}
        >
          {ZIP_LABEL[preset]}
        </Button>
      ))}
      <Divider />
      <Button variant="ghost" size="sm" onClick={onCancel}>
        {select.cancel}
      </Button>
    </section>
  );
}
