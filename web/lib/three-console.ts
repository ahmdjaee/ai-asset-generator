import { setConsoleFunction } from "three";

/**
 * Peringatan three.js dari dependensi yang belum bisa kita ubah. Hanya pesan yang persis sama yang disaring;
 * semua log, warning, dan error lain tetap diteruskan ke console.
 *
 * - `THREE.Clock`: deprecated sejak three r183, tetapi @react-three/fiber 9.8.2 (rilis stabil terbaru,
 *   Nov 2026) masih membuatnya di setiap `<Canvas>`. Hapus entri ini saat R3F memakai `THREE.Timer`.
 */
export const KNOWN_UPSTREAM_WARNINGS: ReadonlySet<string> = new Set([
  "THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.",
]);

let installed = false;

/** Dipanggil sekali oleh modul yang merender kanvas three.js. */
export function installThreeConsoleFilter(): void {
  if (installed) return;
  installed = true;
  setConsoleFunction((type, message, ...params) => {
    if (type === "warn" && KNOWN_UPSTREAM_WARNINGS.has(message)) return;
    console[type](message, ...params);
  });
}
