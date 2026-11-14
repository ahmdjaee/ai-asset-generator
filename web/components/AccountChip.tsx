import { User } from "lucide-react";
import { cn } from "@/lib/utils.ts";

/** Avatar (FigCraft #585): 28×28 bulat, `bg/active`, ikon `user` 16 `text/secondary`. */
export function Avatar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full bg-bg-active text-text-secondary",
        className,
      )}
    >
      <User size={16} />
    </span>
  );
}

/** Chip akun (frame Tahap 7): Avatar + nama (Label) + keterangan (Caption `text/tertiary`), padding 8, jarak 10. */
export function AccountChip({
  name,
  detail,
  className,
}: {
  name: string;
  detail: string;
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5 p-2", className)}>
      <Avatar />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-label text-text-primary">{name}</span>
        <span className="truncate text-caption text-text-tertiary">{detail}</span>
      </span>
    </span>
  );
}
