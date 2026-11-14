/**
 * Preload tes web (`bun run test:web`): DOM dari happy-dom. Hanya untuk tes web, karena happy-dom mengganti
 * global seperti `fetch` dan `Response`.
 */
import { afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://127.0.0.1:4341/", width: 1440, height: 900 });

// Testing Library dimuat setelah DOM terpasang, karena `screen` membaca document.body saat di-import.
const { cleanup } = await import("@testing-library/react");
const { toast } = await import("sonner");

afterEach(() => {
  cleanup();
  // Status toast sonner global untuk satu proses, dan `Toaster` baru memutar ulang toast yang masih aktif. Tanpa ini
  // toast dari tes sebelumnya (jamnya tidak berjalan, jadi tidak pernah kedaluwarsa) muncul lagi di tes berikutnya.
  toast.dismiss();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("style");
});
