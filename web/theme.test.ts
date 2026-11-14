import { describe, expect, test } from "bun:test";
import { createThemeStore, type ThemeEnvironment } from "./theme.ts";
import {
  DEFAULT_THEME,
  isThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  themeBootScript,
} from "./theme-script.ts";

/** Lingkungan browser palsu yang bisa dikendalikan tes. */
function fakeEnvironment(options: { saved?: string; prefersLight?: boolean; storageThrows?: boolean } = {}) {
  const values = new Map<string, string>();
  if (options.saved !== undefined) values.set(THEME_STORAGE_KEY, options.saved);
  const mediaListeners = new Set<() => void>();
  const storageListeners = new Set<(event: StorageEvent) => void>();
  const media = {
    matches: options.prefersLight ?? false,
    addEventListener: (_type: "change", listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_type: "change", listener: () => void) => mediaListeners.delete(listener),
  };
  const root = { dataset: {} as DOMStringMap, style: { colorScheme: "" } };
  const env: ThemeEnvironment = {
    storage: {
      getItem: (key) => {
        if (options.storageThrows) throw new Error("localStorage ditolak");
        return values.get(key) ?? null;
      },
      setItem: (key, value) => {
        if (options.storageThrows) throw new Error("localStorage ditolak");
        values.set(key, value);
      },
    },
    media,
    root,
    events: {
      addEventListener: (_type, listener) => storageListeners.add(listener),
      removeEventListener: (_type, listener) => storageListeners.delete(listener),
    },
  };
  return {
    env,
    root,
    values,
    /** Sistem operasi berganti tema. */
    setSystemLight(light: boolean) {
      media.matches = light;
      for (const listener of mediaListeners) listener();
    },
    /** Tab lain menyimpan pilihan tema. */
    otherTabSaves(value: string) {
      values.set(THEME_STORAGE_KEY, value);
      for (const listener of storageListeners)
        listener(new StorageEvent("storage", { key: THEME_STORAGE_KEY }));
    },
    listenerCount: () => mediaListeners.size + storageListeners.size,
  };
}

describe("resolveTheme dan isThemePreference", () => {
  test("pilihan eksplisit dipakai apa adanya; system mengikuti media query", () => {
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
  });

  test("hanya tiga nilai yang sah", () => {
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("sepia")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });
});

describe("createThemeStore", () => {
  test("tanpa pilihan tersimpan, tema gelap dipakai dan dipasang di <html>", () => {
    const fake = fakeEnvironment({ prefersLight: true });
    const store = createThemeStore(fake.env);
    expect(store.getSnapshot()).toEqual({ preference: DEFAULT_THEME, resolved: "dark" });
    expect(fake.root.dataset.theme).toBe("dark");
    expect(fake.root.style.colorScheme).toBe("dark");
  });

  test("nilai tersimpan yang tidak sah diabaikan", () => {
    const store = createThemeStore(fakeEnvironment({ saved: "sepia" }).env);
    expect(store.getSnapshot().preference).toBe("dark");
  });

  test("setPreference menyimpan pilihan, memasang tema, dan memberi tahu pendengar", () => {
    const fake = fakeEnvironment();
    const store = createThemeStore(fake.env);
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    store.setPreference("light");
    expect(fake.values.get(THEME_STORAGE_KEY)).toBe("light");
    expect(fake.root.dataset.theme).toBe("light");
    expect(store.getSnapshot()).toEqual({ preference: "light", resolved: "light" });
    expect(notified).toBe(1);
    store.setPreference("light");
    expect(notified).toBe(1);
  });

  test("pilihan system mengikuti perubahan tema sistem", () => {
    const fake = fakeEnvironment({ saved: "system", prefersLight: false });
    const store = createThemeStore(fake.env);
    const unsubscribe = store.subscribe(() => undefined);
    expect(store.getSnapshot().resolved).toBe("dark");
    fake.setSystemLight(true);
    expect(store.getSnapshot().resolved).toBe("light");
    expect(fake.root.dataset.theme).toBe("light");
    unsubscribe();
    expect(fake.listenerCount()).toBe(0);
  });

  test("pilihan eksplisit tidak berubah saat tema sistem berganti", () => {
    const fake = fakeEnvironment({ saved: "dark" });
    const store = createThemeStore(fake.env);
    store.subscribe(() => undefined);
    fake.setSystemLight(true);
    expect(store.getSnapshot().resolved).toBe("dark");
  });

  test("pilihan dari tab lain ikut diterapkan", () => {
    const fake = fakeEnvironment();
    const store = createThemeStore(fake.env);
    store.subscribe(() => undefined);
    fake.otherTabSaves("light");
    expect(store.getSnapshot()).toEqual({ preference: "light", resolved: "light" });
  });

  test("localStorage yang ditolak tidak membuat app gagal", () => {
    const fake = fakeEnvironment({ storageThrows: true });
    const store = createThemeStore(fake.env);
    expect(store.getSnapshot().preference).toBe("dark");
    store.setPreference("light");
    expect(fake.root.dataset.theme).toBe("light");
  });
});

describe("skrip tema di <head>", () => {
  const runBootScript = () => {
    // Skrip yang sama persis dengan yang disisipkan vite.config.ts ke index.html.
    new Function(themeBootScript())();
    return document.documentElement.dataset.theme;
  };

  test("tanpa pilihan tersimpan → gelap", () => {
    expect(runBootScript()).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  test("pilihan tersimpan dipakai; nilai tidak sah → gelap", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    expect(runBootScript()).toBe("light");
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(runBootScript()).toBe("dark");
  });

  test("system memakai media query yang sama dengan store", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "system");
    const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    expect(runBootScript()).toBe(resolveTheme("system", prefersLight));
  });
});
