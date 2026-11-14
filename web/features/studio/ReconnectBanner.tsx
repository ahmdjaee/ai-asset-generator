import { TriangleAlert } from "lucide-react";
import { type ReactNode, type Ref, useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/button.tsx";
import { t } from "@/i18n/id.ts";
import { useConnectionState, useRealtime } from "@/lib/realtime-context.tsx";

/**
 * Banner sambung ulang (FigCraft "Banner sambung ulang" #4133): di bawah topbar selebar konten, `warning/soft`, padding
 * 6/8/6/16, ikon `triangle-alert` 16 `warning`, teks Small `text/primary`, tombol Ghost sm "Sambungkan sekarang".
 * Tampilan saja; `ReconnectBanner` memutuskan kapan tampil, dan `ConnectionStatusRegion` mengumumkannya.
 */
export function ReconnectNotice({
  onReconnect,
  ref,
}: {
  onReconnect: () => void;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={ref} className="flex shrink-0 items-center gap-2 bg-warning-soft py-1.5 pr-2 pl-4">
      <TriangleAlert aria-hidden size={16} className="shrink-0 text-warning-text" />
      <p className="min-w-0 flex-1 text-small text-text-primary">{t.connection.lost}</p>
      <Button variant="ghost" size="sm" onClick={onReconnect}>
        {t.connection.reconnect}
      </Button>
    </div>
  );
}

/**
 * Banner yang sedang tampil. Bila banner hilang (tersambung lagi) saat tombolnya fokus, fokus pindah ke area utama
 * (`<main>`), tidak jatuh ke `<body>`. Cleanup layout dari komponen yang dilepas berjalan sebelum elemennya dibuang dari
 * DOM, jadi fokusnya masih terbaca di sini.
 */
function LostConnection({ onReconnect }: { onReconnect: () => void }) {
  const notice = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = notice.current;
    return () => {
      if (element?.contains(document.activeElement)) element.closest<HTMLElement>("main")?.focus();
    };
  }, []);
  return <ReconnectNotice ref={notice} onReconnect={onReconnect} />;
}

/**
 * Live region status sambungan. Di app dipasang kosong sejak awal: region yang disisipkan bersama isinya sering tidak
 * diumumkan pembaca layar. Galeri komponen memakainya juga, supaya DOM-nya sama dengan app.
 */
export function ConnectionStatusRegion({ children }: { children?: ReactNode }) {
  return (
    <div role="status" aria-label={t.connection.status} className="shrink-0">
      {children}
    </div>
  );
}

/** Banner sambung ulang: tampil hanya saat sambungan putus dan klien sedang menunggu percobaan berikutnya. */
export function ReconnectBanner() {
  const client = useRealtime();
  const state = useConnectionState();
  return (
    <ConnectionStatusRegion>
      {state === "reconnecting" ? <LostConnection onReconnect={() => client.reconnectNow()} /> : null}
    </ConnectionStatusRegion>
  );
}
