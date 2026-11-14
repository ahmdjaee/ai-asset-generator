/**
 * Konstanta tema dan skrip kecil yang memasang tema sebelum render pertama.
 * File ini sengaja tanpa DOM, karena juga dipakai `vite.config.ts` untuk menyisipkan skrip ke index.html.
 */

export const THEME_STORAGE_KEY = "aag-theme";
export const THEME_PREFERENCES = ["dark", "light", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = Exclude<ThemePreference, "system">;

/** Tema gelap adalah tema utama desain. */
export const DEFAULT_THEME: ThemePreference = "dark";
export const PREFERS_LIGHT_QUERY = "(prefers-color-scheme: light)";

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

export function resolveTheme(preference: ThemePreference, prefersLight: boolean): ResolvedTheme {
  if (preference === "system") return prefersLight ? "light" : "dark";
  return preference;
}

/**
 * Isi `<script>` di awal `<head>`: membaca preferensi dari localStorage, lalu memasang `data-theme` dan
 * `color-scheme` di `<html>` sebelum CSS dan React dimuat, supaya halaman tidak berkedip.
 * Logikanya sama dengan `resolveTheme`; tes di web/theme.test.ts menjalankan keduanya.
 */
export function themeBootScript(): string {
  const key = JSON.stringify(THEME_STORAGE_KEY);
  const allowed = JSON.stringify(THEME_PREFERENCES);
  const fallback = JSON.stringify(DEFAULT_THEME);
  const query = JSON.stringify(PREFERS_LIGHT_QUERY);
  return [
    "(function () {",
    `  var preference = ${fallback};`,
    "  try {",
    `    var saved = window.localStorage.getItem(${key});`,
    `    if (${allowed}.indexOf(saved) !== -1) preference = saved;`,
    "  } catch (error) {}",
    "  var theme = preference;",
    `  if (preference === "system") theme = window.matchMedia(${query}).matches ? "light" : "dark";`,
    "  document.documentElement.dataset.theme = theme;",
    "  document.documentElement.style.colorScheme = theme;",
    "})();",
  ].join("\n");
}
