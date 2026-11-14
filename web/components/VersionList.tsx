import { RadioGroup } from "radix-ui";
import { t } from "@/i18n/id.ts";
import { cn } from "@/lib/utils.ts";
import { Thumbnail } from "./Thumbnail.tsx";

export type VersionItem = {
  /** Nomor versi (1, 2, …). */
  version: number;
  /** Judul, mis. "v1 · Bentuk dasar". */
  title: string;
  /** Keterangan, mis. "2 mnt lalu · 3.388 segitiga". */
  meta: string;
  thumbnail?: string;
};

/**
 * Pemilih versi (FigCraft Item versi #1278 + "Versi (daftar)" di frame Tahap 7): grup radio. Item: padding
 * 6/10/6/6, jarak 10, radius 8; aktif `bg/active`, hover `bg/hover`. Thumbnail 40×30 radius 5 di atas `bg/viewport`.
 */
export function VersionList({
  versions,
  value,
  onValueChange,
  className,
}: {
  versions: readonly VersionItem[];
  value: number;
  onValueChange: (version: number) => void;
  className?: string;
}) {
  return (
    <RadioGroup.Root
      aria-label={t.versions.label}
      value={String(value)}
      onValueChange={(next) => onValueChange(Number(next))}
      orientation="vertical"
      className={cn("flex flex-col gap-0.5", className)}
    >
      {versions.map((item) => (
        <RadioGroup.Item
          key={item.version}
          value={String(item.version)}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg py-1.5 pr-2.5 pl-1.5 text-left transition-colors",
            "hover:bg-bg-hover focus-visible:outline-offset-1",
            "data-[state=checked]:bg-bg-active",
          )}
        >
          <Thumbnail src={item.thumbnail} className="h-7.5 w-10 rounded-[5px]" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-label text-text-primary">{item.title}</span>
            {/* Di baris aktif (`bg/active`) teks tersier tidak mencapai kontras AA, jadi memakai `text/secondary`. */}
            <span
              className={cn(
                "truncate text-caption tabular-nums",
                item.version === value ? "text-text-secondary" : "text-text-tertiary",
              )}
            >
              {item.meta}
            </span>
          </span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
