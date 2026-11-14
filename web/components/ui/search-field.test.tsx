import { describe, expect, test } from "bun:test";
import { screen } from "@testing-library/react";
import { renderUi } from "@/test-utils.tsx";
import { SearchField } from "./search-field.tsx";

describe("SearchField", () => {
  test("kolom cari bernama; pintasan diumumkan lewat aria-keyshortcuts dan tampil sebagai tombol hiasan", () => {
    renderUi(<SearchField aria-label="Cari aset" placeholder="Cari nama…" shortcut="/" />);
    const input = screen.getByRole("searchbox", { name: "Cari aset" });
    expect(input.getAttribute("aria-keyshortcuts")).toBe("/");
    expect(input.getAttribute("placeholder")).toBe("Cari nama…");
    const kbd = input.parentElement?.querySelector("kbd");
    expect(kbd?.textContent).toBe("/");
    expect(kbd?.getAttribute("aria-hidden")).toBe("true");
  });

  test("tanpa pintasan: tanpa tombol hiasan dan tanpa aria-keyshortcuts", () => {
    renderUi(<SearchField aria-label="Cari aset" />);
    const input = screen.getByRole("searchbox", { name: "Cari aset" });
    expect(input.hasAttribute("aria-keyshortcuts")).toBe(false);
    expect(input.parentElement?.querySelector("kbd")).toBeNull();
  });

  test("mengetik mengisi kolom", async () => {
    const { user } = renderUi(<SearchField aria-label="Cari aset" />);
    await user.type(screen.getByRole("searchbox", { name: "Cari aset" }), "peti");
    expect(screen.getByRole<HTMLInputElement>("searchbox", { name: "Cari aset" }).value).toBe("peti");
  });
});
