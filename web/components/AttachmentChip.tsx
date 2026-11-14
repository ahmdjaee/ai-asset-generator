import { File as FileIcon, LoaderCircle, X } from "lucide-react";
import { t } from "@/i18n/id.ts";
import { cn } from "@/lib/utils.ts";

export type AttachmentChipProps = {
  name: string;
  /** Keterangan, mis. "JPG · 184 KB". Diganti teks status saat mengunggah atau gagal. */
  meta?: string;
  /** URL thumbnail gambar; selain gambar memakai ikon file. */
  thumbnail?: string;
  status?: "ready" | "uploading" | "error";
  /** Ada → tombol hapus `x` 14 di kanan. */
  onRemove?: () => void;
  /** Versi ringkas di pesan (FigCraft #1292): thumbnail 28, hanya nama, tanpa tombol hapus. */
  compact?: boolean;
  className?: string;
};

function Thumbnail({
  thumbnail,
  status,
  compact,
}: Pick<AttachmentChipProps, "thumbnail" | "status" | "compact">) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden bg-bg-viewport text-text-tertiary",
        compact ? "size-7 rounded-[5px]" : "size-9 rounded-md",
      )}
    >
      {status === "uploading" ? (
        <LoaderCircle size={16} className="animate-spin" />
      ) : thumbnail ? (
        <img src={thumbnail} alt="" className="size-full object-cover" />
      ) : (
        <FileIcon size={16} />
      )}
    </span>
  );
}

/**
 * Chip lampiran (FigCraft composer #818 dan pesan #1292): `bg/raised`, garis `border/default`, radius 8,
 * padding 4/10/4/4. Tempat thumbnail memakai `bg/viewport` (desain: #E8E2D6 mentah, hanya tampak bila gambar gagal).
 */
export function AttachmentChip({
  name,
  meta,
  thumbnail,
  status = "ready",
  onRemove,
  compact = false,
  className,
}: AttachmentChipProps) {
  const detail =
    status === "uploading" ? t.attachment.uploading : status === "error" ? t.attachment.failed : meta;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-lg border bg-bg-raised py-1 pr-2.5 pl-1",
        status === "error" ? "border-danger-text" : "border-border-default",
        compact ? "gap-2" : "gap-2.5",
        className,
      )}
    >
      <Thumbnail thumbnail={thumbnail} status={status} compact={compact} />
      {compact ? (
        <span className="min-w-0 truncate text-caption text-text-secondary">{name}</span>
      ) : (
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-caption-strong text-text-primary">{name}</span>
          {detail === undefined ? null : (
            <span
              className={cn(
                "truncate text-caption",
                status === "error" ? "text-danger-text" : "text-text-tertiary",
              )}
            >
              {detail}
            </span>
          )}
        </span>
      )}
      {onRemove && !compact ? (
        <button
          type="button"
          aria-label={t.attachment.remove(name)}
          onClick={onRemove}
          className={cn(
            "-m-[3px] shrink-0 rounded-sm p-[3px] text-text-tertiary transition-colors hover:text-text-primary",
            "focus-visible:outline-offset-1",
          )}
        >
          <X size={14} />
        </button>
      ) : null}
    </span>
  );
}
