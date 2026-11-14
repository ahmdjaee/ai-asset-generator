import { createContext, use, useSyncExternalStore } from "react";
import {
  DEFAULT_THEME,
  isThemePreference,
  PREFERS_LIGHT_QUERY,
  type ResolvedTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "./theme-script.ts";

/**
 * Tema gelap/terang/ikut sistem (port dari ai-team `web/theme.ts`).
 * Skrip di index.html memasang tema sebelum render pertama; store ini melanjutkannya setelah React berjalan:
 * menyimpan pilihan, mengikuti perubahan tema sistem, dan menyamakan tab lain lewat event `storage`.
 */

export type ThemeState = Readonly<{ preference: ThemePreference; resolved: ResolvedTheme }>;

/** Bagian browser yang dipakai store tema, cukup kecil supaya tes bisa memberi versi palsunya. */
export type ThemeEnvironment = {
  /** `window.localStorage` */
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  /** `window.matchMedia(PREFERS_LIGHT_QUERY)` */
  media: {
    readonly matches: boolean;
    addEventListener(type: "change", listener: () => void): void;
    removeEventListener(type: "change", listener: () => void): void;
  };
  /** `document.documentElement` */
  root: { dataset: DOMStringMap; style: { colorScheme: string } };
  /** `window`, untuk event `storage` dari tab lain. */
  events: {
    addEventListener(type: "storage", listener: (event: StorageEvent) => void): void;
    removeEventListener(type: "storage", listener: (event: StorageEvent) => void): void;
  };
};

export type ThemeStore = {
  getSnapshot: () => ThemeState;
  subscribe: (listener: () => void) => () => void;
  setPreference: (preference: ThemePreference) => void;
};

export function createThemeStore(env: ThemeEnvironment): ThemeStore {
  const listeners = new Set<() => void>();

  const readPreference = (): ThemePreference => {
    try {
      const saved = env.storage.getItem(THEME_STORAGE_KEY);
      return isThemePreference(saved) ? saved : DEFAULT_THEME;
    } catch {
      // localStorage bisa ditolak browser; tema bawaan tetap dipakai.
      return DEFAULT_THEME;
    }
  };
  const compute = (preference: ThemePreference): ThemeState => ({
    preference,
    resolved: resolveTheme(preference, env.media.matches),
  });
  const applyToDocument = (resolved: ResolvedTheme) => {
    env.root.dataset.theme = resolved;
    env.root.style.colorScheme = resolved;
  };

  let state = compute(readPreference());
  applyToDocument(state.resolved);

  const update = (next: ThemeState) => {
    if (next.preference === state.preference && next.resolved === state.resolved) return;
    state = next;
    applyToDocument(next.resolved);
    for (const listener of listeners) listener();
  };
  const onSystemChange = () => update(compute(state.preference));
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) update(compute(readPreference()));
  };

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        env.media.addEventListener("change", onSystemChange);
        env.events.addEventListener("storage", onStorage);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          env.media.removeEventListener("change", onSystemChange);
          env.events.removeEventListener("storage", onStorage);
        }
      };
    },
    setPreference(preference) {
      try {
        env.storage.setItem(THEME_STORAGE_KEY, preference);
      } catch {
        // Tidak bisa disimpan: pilihan tetap berlaku sampai halaman dimuat ulang.
      }
      update(compute(preference));
    },
  };
}

function browserStorage(): ThemeEnvironment["storage"] {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => undefined };
  }
}

let browserStore: ThemeStore | undefined;

function getBrowserStore(): ThemeStore {
  browserStore ??= createThemeStore({
    storage: browserStorage(),
    media: window.matchMedia(PREFERS_LIGHT_QUERY),
    root: document.documentElement,
    events: window,
  });
  return browserStore;
}

/** Store pengganti untuk tes komponen. Tanpa provider, `useTheme` memakai store browser. */
export const ThemeStoreContext = createContext<ThemeStore | null>(null);

export function useTheme(): ThemeState & { setPreference: (preference: ThemePreference) => void } {
  const store = use(ThemeStoreContext) ?? getBrowserStore();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { ...state, setPreference: store.setPreference };
}
