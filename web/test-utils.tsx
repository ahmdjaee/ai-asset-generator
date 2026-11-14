import { spyOn } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import { QUERY_STALE_TIME_MS } from "@/lib/query.ts";

/** Client query untuk tes: tanpa retry, supaya state error langsung terlihat. */
export function renderWithQuery(ui: ReactNode) {
  // Cache sama dengan app (`createQueryClient`), supaya tes ikut menangkap data basi; tanpa coba ulang.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: QUERY_STALE_TIME_MS } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/**
 * Merender komponen UI dengan provider yang dipakai app: Tooltip (wajib untuk Radix) dan router memori
 * (untuk komponen yang memuat tautan). Mengembalikan `user` dari user-event.
 */
export function renderUi(ui: ReactNode, path = "/") {
  const result = render(
    <TooltipProvider>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </TooltipProvider>,
  );
  return { ...result, user: userEvent.setup() };
}

/**
 * Mengganti `fetch` global untuk satu tes. `handler` menerima path permintaan (mis. `/api/health`) dan permintaannya
 * (metode, query, isi). Kembalikan spy-nya; panggil `mockRestore()` di akhir tes.
 */
export function mockFetch(handler: (path: string, request: Request) => Response | Promise<Response>) {
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    return handler(new URL(request.url).pathname, request);
  };
  // Tipe `fetch` di Bun juga punya `preconnect`; client API tidak memakainya.
  const preconnect: typeof fetch.preconnect = () => undefined;
  return spyOn(globalThis, "fetch").mockImplementation(Object.assign(fakeFetch, { preconnect }));
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
