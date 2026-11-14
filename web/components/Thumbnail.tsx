import { useState } from "react";
import { cn } from "@/lib/utils.ts";

/**
 * Gambar kecil aset di atas `bg/viewport` (baris versi, kartu mini Studio, baris daftar Gudang). Hiasan: `alt` kosong,
 * nama aset sudah ada di teks di sebelahnya. Gambar yang gagal dimuat (mis. thumbnail belum dibuat) disembunyikan,
 * jadi yang tampil hanya latar viewport, bukan ikon gambar rusak.
 */
export function Thumbnail({ src, className }: { src: string | undefined; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span aria-hidden className={cn("block shrink-0 overflow-hidden bg-bg-viewport", className)}>
      {src === undefined || failed === src ? null : (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(src)}
          className="size-full object-contain"
        />
      )}
    </span>
  );
}
