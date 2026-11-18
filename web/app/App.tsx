import { QueryClientProvider } from "@tanstack/react-query";
import { LucideProvider } from "lucide-react";
import { useEffect, useState } from "react";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { Toaster } from "@/components/ui/toast.tsx";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import { installGlobalErrorToast } from "@/lib/global-errors.ts";
import { createQueryClient } from "@/lib/query.ts";
import { routes } from "./routes.tsx";

const router = createBrowserRouter(routes);

/**
 * Root app. Ikon Lucide memakai garis 1,5 px di semua ukuran (`nonScalingStroke`); desain menggambar 1,46 px
 * konstan saat ikon diperkecil (lihat Log keputusan Tahap 7).
 */
export function App() {
  const [queryClient] = useState(createQueryClient);
  useEffect(() => installGlobalErrorToast(window), []);
  return (
    <QueryClientProvider client={queryClient}>
      <LucideProvider strokeWidth={1.5} nonScalingStroke>
        <TooltipProvider>
          <RouterProvider router={router} />
          <Toaster />
        </TooltipProvider>
      </LucideProvider>
    </QueryClientProvider>
  );
}
