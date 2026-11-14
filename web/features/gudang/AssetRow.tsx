import { useId } from "react";
import { Link } from "react-router";
import type { CardSelection } from "@/components/AssetCard.tsx";
import { Thumbnail } from "@/components/Thumbnail.tsx";
import { TierIndicator } from "@/components/Tier.tsx";
import { Badge, type BadgeTone } from "@/components/ui/badge.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { t } from "@/i18n/id.ts";
import { cn } from "@/lib/utils.ts";
import type { TierId } from "../../../shared/limits.ts";

/**
 * Lebar kolom daftar (FigCraft "Daftar aset" #4886): Aset mengisi sisa, Tier 96, Status 128, Ukuran 168, Diubah 96,
 * Aksi 28; jarak antarkolom 16. Kepala dan baris memakai kelas yang sama supaya kolomnya sejajar.
 */
const COLUMN = {
  asset: "min-w-0 flex-1",
  tier: "w-24 shrink-0",
  status: "w-32 shrink-0",
  size: "w-42 shrink-0",
  updated: "w-24 shrink-0",
  actions: "w-7 shrink-0",
} as const;

/**
 * Kepala daftar (#4887): tinggi 36, padding-x 16, Overline `text/tertiary`, garis bawah. Hanya tampilan: setiap baris
 * sudah menjelaskan isinya sendiri (nama, tier, badge status, ukuran, waktu), jadi kepala disembunyikan dari pembaca
 * layar. Mode pilih tanpa kolom Aksi (#4969).
 */
export function AssetRowsHeader({ selecting }: { selecting: boolean }) {
  const { columns } = t.gudang;
  return (
    <div
      aria-hidden
      className="flex h-9 items-center gap-4 border-border-default border-b px-4 text-overline text-text-tertiary uppercase"
    >
      <span className={COLUMN.asset}>{columns.asset}</span>
      <span className={COLUMN.tier}>{columns.tier}</span>
      <span className={COLUMN.status}>{columns.status}</span>
      <span className={COLUMN.size}>{columns.size}</span>
      <span className={COLUMN.updated}>{columns.updated}</span>
      {selecting ? null : <span className={COLUMN.actions} />}
    </div>
  );
}

/** Kelas cincin fokus baris: digambar di dalam baris (offset negatif) supaya tidak terpotong sudut wadah daftar. */
const ROW_RING =
  "has-[[data-row-focus]:focus-visible]:outline-2 has-[[data-row-focus]:focus-visible]:outline-accent-ring has-[[data-row-focus]:focus-visible]:-outline-offset-2";

/**
 * Baris daftar Gudang (FigCraft #4886/#4969): padding 10/16, jarak 16, hover `bg/hover`. Kolom Aset: thumbnail 56×42
 * radius 6 + nama Label dan prompt Caption `text/tertiary` satu baris (jarak 2). Seluruh baris adalah tautan ke Detail
 * aset; menu "…" (`actions`) di atas tautan itu. Mode pilih: kotak centang di depan thumbnail (jarak 12), kolom Aksi
 * hilang, klik di mana saja memilih; baris terpilih tidak berubah warna.
 */
export function AssetRow({
  name,
  prompt,
  href,
  linkState,
  thumbnail,
  tier,
  badge,
  info,
  time,
  selection,
  actions,
}: {
  name: string;
  prompt: string;
  href: string;
  linkState?: unknown;
  thumbnail: string | undefined;
  tier: TierId;
  badge: { tone: BadgeTone; label: string };
  info: string;
  time: string;
  selection?: CardSelection;
  actions?: React.ReactNode;
}) {
  const checkboxId = useId();
  return (
    <article
      className={cn(
        "relative flex items-center gap-4 px-4 py-2.5 transition-colors hover:bg-bg-hover",
        ROW_RING,
      )}
    >
      <div className={cn(COLUMN.asset, "flex items-center gap-3")}>
        {selection === undefined ? null : (
          <Checkbox
            id={checkboxId}
            data-row-focus=""
            aria-label={selection.label}
            checked={selection.selected}
            disabled={selection.disabled}
            onCheckedChange={selection.onToggle}
            // Di atas lapisan klik judul (`label::after` menutupi baris), supaya kotak centang menerima klik sendiri.
            className="relative z-1 outline-none"
          />
        )}
        <Thumbnail src={thumbnail} className="h-10.5 w-14 rounded-md" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="truncate text-label text-text-primary">
            {selection === undefined ? (
              <Link
                to={href}
                state={linkState}
                data-row-focus=""
                className="outline-none after:absolute after:inset-0"
              >
                {name}
              </Link>
            ) : (
              <label
                htmlFor={checkboxId}
                className={cn("after:absolute after:inset-0", !selection.disabled && "after:cursor-pointer")}
              >
                {name}
              </label>
            )}
          </h3>
          <p className="truncate text-caption text-text-tertiary">{prompt}</p>
        </div>
      </div>
      <div className={COLUMN.tier}>
        <TierIndicator tier={tier} className="text-text-secondary" />
      </div>
      <div className={COLUMN.status}>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>
      <p className={cn(COLUMN.size, "truncate text-caption text-text-secondary")}>{info}</p>
      <p className={cn(COLUMN.updated, "truncate text-caption text-text-tertiary")}>{time}</p>
      {selection === undefined ? <div className={cn(COLUMN.actions, "relative")}>{actions}</div> : null}
    </article>
  );
}
