import { QueryClient } from "@tanstack/react-query";

/** Data yang lebih muda dari ini tidak diambil ulang saat komponen dipasang lagi (perubahan datang lewat WebSocket). */
export const QUERY_STALE_TIME_MS = 30_000;

/**
 * Data server segar lewat event WebSocket (Tahap 6), bukan polling atau refetch saat jendela fokus.
 * Gagal sekali dicoba ulang satu kali; error berikutnya ditampilkan oleh komponen.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: false, staleTime: QUERY_STALE_TIME_MS },
    },
  });
}
