import { FileQuestion, RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { Link, useRouteError } from "react-router";
import { EmptyState } from "@/components/EmptyState.tsx";
import { ThemeToggle } from "@/components/ThemeToggle.tsx";
import { Button } from "@/components/ui/button.tsx";
import { t } from "@/i18n/id.ts";
import { Topbar } from "./shell/Topbar.tsx";

/** Pengaturan: belum digambar di FigCraft; disusun dari komponen yang ada. Bagian lain dibangun di Tahap 11. */
export function SettingsPage() {
  return (
    <>
      <Topbar>
        <h1 className="text-heading text-text-primary">{t.settings.title}</h1>
      </Topbar>
      <div className="flex-1 overflow-y-auto">
        <div className="flex max-w-180 flex-col gap-8 px-6 pt-6 pb-16">
          <section aria-labelledby="pengaturan-tema" className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 id="pengaturan-tema" className="text-label text-text-primary">
                {t.theme.label}
              </h2>
              <p className="text-small text-text-secondary">{t.settings.themeDescription}</p>
            </div>
            <ThemeToggle />
          </section>
        </div>
      </div>
    </>
  );
}

export function NotFoundPage() {
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
      <EmptyState
        icon={FileQuestion}
        headingLevel={1}
        title={t.notFound.title}
        description={t.notFound.description}
        action={
          <Button asChild variant="secondary" size="sm">
            <Link to="/">{t.notFound.back}</Link>
          </Button>
        }
      />
    </div>
  );
}

/** Ditampilkan saat rute gagal dimuat (misalnya chunk lazy gagal diunduh). */
export function RouteErrorPage() {
  const error = useRouteError();
  useEffect(() => {
    console.error("Rute gagal dimuat:", error);
  }, [error]);
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg-app p-6">
      <EmptyState
        icon={RotateCcw}
        headingLevel={1}
        title={t.routeError.title}
        description={t.routeError.description}
        action={
          <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
            {t.routeError.reload}
          </Button>
        }
      />
    </main>
  );
}

/** Ditampilkan sekejap saat rute lazy pertama sedang dimuat. */
export function RouteLoading() {
  return (
    <p role="status" className="p-8 text-small text-text-secondary">
      {t.loading}
    </p>
  );
}
