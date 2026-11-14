import { useCallback, useMemo, useSyncExternalStore } from "react";

/** Query sistem "animasi dikurangi" (AGENTS.md §2: wajib dihormati). */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeTo(query: string) {
  return (onChange: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  };
}

/** Nilai media query yang ikut berubah saat pengaturan sistem berubah. */
export function useMediaQuery(query: string): boolean {
  // Fungsi langganan stabil per query; fungsi baru di setiap render membuat React berlangganan ulang.
  const subscribe = useMemo(() => subscribeTo(query), [query]);
  const read = useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, read, () => false);
}

export function useReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY);
}
