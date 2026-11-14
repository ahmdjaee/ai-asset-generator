import { describe, expect, test } from "bun:test";
import { screen, waitFor } from "@testing-library/react";
import { renderUi } from "@/test-utils.tsx";
import { createThemeStore, ThemeStoreContext } from "@/theme.ts";
import { THEME_STORAGE_KEY } from "@/theme-script.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";

/** Store tema di atas DOM happy-dom; sistem dianggap memakai tema terang. */
function renderToggle() {
  const store = createThemeStore({
    storage: window.localStorage,
    media: { matches: true, addEventListener: () => undefined, removeEventListener: () => undefined },
    root: document.documentElement,
    events: window,
  });
  return renderUi(
    <ThemeStoreContext value={store}>
      <ThemeToggle />
    </ThemeStoreContext>,
  );
}

const checked = (name: string) => screen.getByRole("radio", { name }).getAttribute("aria-checked");

describe("ThemeToggle", () => {
  test("tiga pilihan dalam grup radio Tema, Gelap terpilih secara bawaan", () => {
    renderToggle();
    expect(screen.getByRole("radiogroup", { name: "Tema" })).toBeDefined();
    expect(checked("Gelap")).toBe("true");
    expect(checked("Terang")).toBe("false");
    expect(checked("Sistem")).toBe("false");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  test("klik Terang: tema berganti dan pilihan disimpan", async () => {
    const { user } = renderToggle();
    await user.click(screen.getByRole("radio", { name: "Terang" }));
    expect(checked("Terang")).toBe("true");
    expect(checked("Gelap")).toBe("false");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  test("Sistem memakai tema sistem", async () => {
    const { user } = renderToggle();
    await user.click(screen.getByRole("radio", { name: "Sistem" }));
    expect(checked("Sistem")).toBe("true");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  test("keyboard: Tab ke pilihan aktif, panah kanan memilih tema berikutnya", async () => {
    const { user } = renderToggle();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Gelap" }));
    await user.keyboard("{ArrowRight>}");
    await waitFor(() => expect(checked("Terang")).toBe("true"));
    await user.keyboard("{/ArrowRight}");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
