import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { API_PORT, WEB_DEV_PORT } from "./shared/ports.ts";
import { themeBootScript } from "./web/theme-script.ts";

/** Port API: `PORT` dari .env bila diisi (sama dengan yang dibaca server), selain itu bawaan. */
const apiPort = Number(process.env.PORT) || API_PORT;

/** Menyisipkan skrip tema di awal <head>, supaya tema terpasang sebelum CSS dan React dimuat. */
function themeScript(): Plugin {
  return {
    name: "aag-theme-script",
    transformIndexHtml: () => [{ tag: "script", children: themeBootScript(), injectTo: "head-prepend" }],
  };
}

export default defineConfig(({ mode }) => ({
  root: "web",
  publicDir: "public",
  plugins: [react(), tailwindcss(), themeScript()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./web", import.meta.url)) },
  },
  server: {
    host: "127.0.0.1",
    port: WEB_DEV_PORT,
    strictPort: true,
    proxy: {
      // ws: true → WebSocket /api/ws ikut diteruskan ke server API.
      "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true, ws: true },
    },
  },
  build: {
    // Build mode test (dipakai E2E) memuat halaman uji internal, jadi dipisah dari build produksi.
    outDir: mode === "test" ? "../dist-test" : "../dist",
    emptyOutDir: true,
    // Chunk 3D (three + R3F + drei, ±1 MB) dimuat lazy dari localhost; batas bawaan 500 kB tidak relevan untuk app lokal.
    chunkSizeWarningLimit: 1200,
  },
}));
