import { Outlet } from "react-router";
import { buttonVariants } from "@/components/ui/button.tsx";
import { StatusWatcher } from "@/features/status/StatusWatcher.tsx";
import { AssetWatcher } from "@/features/studio/AssetWatcher.tsx";
import { t } from "@/i18n/id.ts";
import { useStudioBusy } from "@/lib/assets.ts";
import { cn } from "@/lib/utils.ts";
import { Rail } from "./shell/Rail.tsx";

/**
 * Kerangka app sesuai FigCraft (layar 01–03): rel 64 px di kiri, area utama berisi topbar dan konten halaman.
 * Tautan "Lewati ke konten utama" hanya terlihat saat mendapat fokus keyboard, sebagai Button Secondary sm. Selain
 * itu `sr-only`; `not-sr-only` tidak dipakai karena mengembalikan padding 0, tinggi auto, dan teks yang bisa terlipat.
 */
export function AppLayout() {
  const busy = useStudioBusy();
  return (
    <div className="flex h-dvh overflow-hidden bg-bg-app">
      <a
        href="#konten"
        className={cn(
          buttonVariants({ variant: "secondary", size: "sm" }),
          "fixed top-3 left-20 z-50 not-focus-visible:sr-only",
        )}
      >
        {t.shell.skipToContent}
      </a>
      <AssetWatcher />
      <StatusWatcher />
      <Rail studioBusy={busy} />
      <main id="konten" tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">
        <Outlet />
      </main>
    </div>
  );
}
