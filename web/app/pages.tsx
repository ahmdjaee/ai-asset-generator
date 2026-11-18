import { FileQuestion, RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { Link, useRouteError } from "react-router";
import { EmptyState } from "@/components/EmptyState.tsx";
import { Button } from "@/components/ui/button.tsx";
import { t } from "@/i18n/id.ts";

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

/** Ditampilkan saat kerangka app sendiri gagal (error halaman ditangani `PageErrorPage`). */
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

/**
 * Error di satu halaman (render gagal, chunk lazy gagal diunduh): tampil di area utama, jadi rel dan topbar halaman
 * lain tetap bisa dipakai. Pindah halaman lewat rel membersihkan error-nya.
 */
export function PageErrorPage() {
  const error = useRouteError();
  useEffect(() => {
    console.error("Halaman gagal ditampilkan:", error);
  }, [error]);
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
      <EmptyState
        icon={RotateCcw}
        headingLevel={1}
        title={t.pageError.title}
        description={t.pageError.description}
        action={
          <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
            {t.pageError.reload}
          </Button>
        }
      />
    </div>
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
