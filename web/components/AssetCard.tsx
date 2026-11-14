import { Rotate3d } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router";
import { Badge, type BadgeTone } from "@/components/ui/badge.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { t } from "@/i18n/id.ts";
import { useReducedMotion } from "@/lib/use-media-query.ts";
import { cn } from "@/lib/utils.ts";
import { type TierId, TURNTABLE_FRAMES } from "../../shared/limits.ts";
import { TierIndicator } from "./Tier.tsx";

/** Mode pilih Gudang: kotak centang di kanan atas, klik di mana saja pada kartu memilih atau membatalkan. */
export type CardSelection = Readonly<{
  selected: boolean;
  /** Aset tanpa versi tidak bisa dipilih (tidak ada yang bisa diekspor). */
  disabled: boolean;
  /** Nama kotak centang, mis. "Pilih Peti harta kayu". */
  label: string;
  onToggle: () => void;
}>;

export type AssetCardProps = {
  name: string;
  /** Tujuan saat kartu diklik (di luar mode pilih). */
  href: string;
  /** `state` navigasi tautan (mis. filter Gudang untuk tautan kembali di Detail aset). */
  linkState?: unknown;
  /** URL gambar thumbnail; tanpa ini hanya latar `bg/viewport`. */
  thumbnail?: string;
  /** URL strip turntable (frame berjajar mendatar); dimuat saat kartu pertama kali disorot. */
  turntable?: string;
  badge: { tone: BadgeTone; label: string };
  tier: TierId;
  /** Waktu relatif, mis. "2 jam lalu". */
  time: string;
  /** Info singkat, mis. "3,4k segitiga · 612 KB" atau "Tahap 2 · 62%". */
  info: string;
  /** Progres proses yang berjalan (0..1): bar 3 px di tepi bawah thumbnail. */
  progress?: number;
  selection?: CardSelection;
  className?: string;
};

/** Durasi satu putaran turntable saat hover. */
const TURNTABLE_SPIN_MS = 2000;

/**
 * Gambar kartu: thumbnail, lalu strip turntable yang dianimasikan lewat `background-position` saat kartu disorot
 * (tanpa WebGL per kartu). Strip baru diminta saat kartu pertama kali disorot, dan chip "360°" baru tampil setelah
 * strip selesai dimuat. Saat sistem meminta animasi dikurangi, strip tidak dimuat dan chip tidak tampil.
 */
function CardImage({
  thumbnail,
  turntable,
  spinning,
}: {
  thumbnail: string | undefined;
  turntable: string | undefined;
  /** Kartu pernah disorot: strip boleh dimuat. */
  spinning: boolean;
}) {
  // Dicatat per URL: versi baru (URL lain) dicoba lagi walau thumbnail versi lama gagal, dan stripnya menunggu dimuat.
  const [failedThumb, setFailedThumb] = useState<string | null>(null);
  const [readyStrip, setReadyStrip] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  const loadStrip = turntable !== undefined && spinning && !reducedMotion;
  return (
    <>
      {thumbnail === undefined || failedThumb === thumbnail ? null : (
        <img
          src={thumbnail}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailedThumb(thumbnail)}
          className="size-full object-contain"
        />
      )}
      {loadStrip ? (
        // Pemuat strip: tidak tampil, hanya menandai strip siap di cache browser.
        <img src={turntable} alt="" hidden onLoad={() => setReadyStrip(turntable)} data-turntable-loader="" />
      ) : null}
      {loadStrip && readyStrip === turntable ? (
        <>
          <span
            aria-hidden
            data-turntable=""
            className="absolute inset-0 hidden bg-no-repeat group-hover:block group-has-focus-visible:block"
            style={{
              backgroundImage: `url("${turntable}")`,
              backgroundSize: `${TURNTABLE_FRAMES * 100}% 100%`,
              animation: `turntable ${TURNTABLE_SPIN_MS}ms steps(${TURNTABLE_FRAMES}, jump-none) infinite`,
            }}
          />
          <span
            aria-hidden
            className={cn(
              "absolute right-2.5 bottom-2.5 hidden h-5.5 items-center gap-1 rounded-md border border-border-default bg-bg-panel pr-2 pl-1.5",
              "text-caption-strong text-text-secondary group-hover:flex group-has-focus-visible:flex",
            )}
          >
            <Rotate3d size={14} className="shrink-0" />
            {t.assetCard.turntable}
          </span>
        </>
      ) : null}
    </>
  );
}

/**
 * Kartu aset (FigCraft AssetCard #2641): lebar 252, `bg/panel`, garis `border/default` (hover `border/strong`),
 * radius 12. Thumbnail 189 tinggi di atas `bg/viewport` + Badge status di kiri atas; saat disorot turntable berputar
 * dan chip "360°" tampil di kanan bawah. Seluruh kartu bisa diklik lewat tautan di judul.
 *
 * Mode pilih (frame "Tahap 10 · Gudang, detail, ekspor" F): kotak centang 20 px di kanan atas thumbnail (sejajar
 * Badge), kartu terpilih bergaris `accent/solid`. Klik di mana saja memilih lewat label judul yang menutupi kartu.
 * Cincin fokus selalu digambar di kartu, bukan di tautan atau kotak centang di dalamnya.
 */
export function AssetCard({
  name,
  href,
  linkState,
  thumbnail,
  turntable,
  badge,
  tier,
  time,
  info,
  progress,
  selection,
  className,
}: AssetCardProps) {
  const checkboxId = useId();
  const [spinning, setSpinning] = useState(false);
  const selected = selection?.selected === true;
  return (
    <article
      onPointerEnter={() => setSpinning(true)}
      onFocus={() => setSpinning(true)}
      className={cn(
        "group relative flex w-63 flex-col overflow-hidden rounded-xl border bg-bg-panel transition-colors",
        selected
          ? "border-accent-solid"
          : "border-border-default hover:border-border-strong has-focus-visible:border-border-strong",
        "has-focus-visible:outline-2 has-focus-visible:outline-accent-ring has-focus-visible:outline-offset-2",
        className,
      )}
    >
      <div className="relative h-[189px] shrink-0 bg-bg-viewport">
        <CardImage thumbnail={thumbnail} turntable={turntable} spinning={spinning} />
        <Badge tone={badge.tone} className="absolute top-2.5 left-2.5">
          {badge.label}
        </Badge>
        {selection === undefined ? null : (
          <Checkbox
            id={checkboxId}
            aria-label={selection.label}
            checked={selection.selected}
            disabled={selection.disabled}
            onCheckedChange={selection.onToggle}
            // Di atas lapisan klik judul (`label::after` menutupi kartu), supaya kotak centang menerima klik sendiri.
            className="absolute top-[11px] right-2.5 z-1 outline-none"
          />
        )}
        {progress === undefined ? null : (
          <div
            role="progressbar"
            aria-label={t.assetCard.progress(name)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(Math.min(Math.max(progress, 0), 1) * 100)}
            className="absolute inset-x-0 bottom-0 h-[3px] bg-border-default"
          >
            <div
              className="h-full bg-accent-solid"
              style={{ width: `${Math.min(Math.max(progress, 0), 1) * 100}%` }}
            />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5 px-3.5 pt-3 pb-3.5">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-label text-text-primary">
            {selection === undefined ? (
              <Link to={href} state={linkState} className="outline-none after:absolute after:inset-0">
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
          <span className="shrink-0 text-caption text-text-tertiary">{time}</span>
        </div>
        <div className="flex items-center gap-2">
          <TierIndicator tier={tier} className="text-text-secondary" />
          <span className="truncate text-caption text-text-tertiary">{info}</span>
        </div>
      </div>
    </article>
  );
}
