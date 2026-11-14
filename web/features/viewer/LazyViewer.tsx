import { lazy, Suspense } from "react";
import { t } from "@/i18n/id.ts";
import type { ViewerProps } from "./Viewer.tsx";

// three + R3F + drei hanya dimuat saat viewer tampil (chunk terpisah, AGENTS.md §9).
const ViewerChunk = lazy(async () => {
  const module = await import("./Viewer.tsx");
  return { default: module.Viewer };
});

function ViewerPlaceholder() {
  return (
    <div className="flex size-full items-center justify-center bg-bg-viewport">
      <p role="status" className="text-small text-text-secondary">
        {t.viewer.loading}
      </p>
    </div>
  );
}

/** Viewer 3D yang dimuat lazy. Selama chunk dimuat, area viewport tetap berwarna latar viewer. */
export function LazyViewer(props: ViewerProps) {
  return (
    <Suspense fallback={<ViewerPlaceholder />}>
      <ViewerChunk {...props} />
    </Suspense>
  );
}
