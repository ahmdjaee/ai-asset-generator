import { describe, expect, mock, test } from "bun:test";
import { screen } from "@testing-library/react";
import { Grid3x3, Settings } from "lucide-react";
import { NavLink } from "react-router";
import { renderUi } from "@/test-utils.tsx";
import { IconButton } from "./icon-button.tsx";

describe("IconButton", () => {
  test("nama dari label, ikon md 18 px, klik dan keyboard memanggil onClick", async () => {
    const onClick = mock();
    const { user } = renderUi(<IconButton icon={Grid3x3} label="Grid lantai" onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Grid lantai" });
    expect(button.className).toContain("size-8");
    expect(button.querySelector("svg")?.getAttribute("width")).toBe("18");
    await user.click(button);
    button.focus();
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  test("tooltip tidak dijadikan deskripsi (nama tidak dibaca dua kali); pintasan lewat aria-keyshortcuts", async () => {
    const { user } = renderUi(<IconButton icon={Grid3x3} label="Grid lantai" shortcut="G" />);
    await user.tab();
    const button = screen.getByRole("button", { name: "Grid lantai" });
    expect((await screen.findByRole("tooltip")).textContent).toContain("Grid lantai");
    expect(button.getAttribute("aria-describedby")).toBeNull();
    expect(button.getAttribute("aria-keyshortcuts")).toBe("G");
  });

  test("ukuran sm 28 px dengan ikon 16; Secondary bergaris border/default", () => {
    renderUi(<IconButton icon={Grid3x3} label="Grid" size="sm" variant="secondary" />);
    const button = screen.getByRole("button", { name: "Grid" });
    expect(button.className).toContain("size-7");
    expect(button.className).toContain("border-border-default");
    expect(button.querySelector("svg")?.getAttribute("width")).toBe("16");
  });

  test("aktif memakai bg/active dan teks primer", () => {
    renderUi(<IconButton icon={Grid3x3} label="Grid" active aria-pressed />);
    const button = screen.getByRole("button", { name: "Grid", pressed: true });
    expect(button.className).toContain("bg-bg-active");
    expect(button.className).toContain("text-text-primary");
  });

  test("fokus keyboard membuka tooltip berisi label dan pintasan", async () => {
    const { user } = renderUi(<IconButton icon={Grid3x3} label="Grid lantai" shortcut="G" />);
    await user.tab();
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toContain("Grid lantai");
    expect(tooltip.textContent).toContain("G");
  });

  test("asChild: tautan bergaya IconButton dengan ikon di dalamnya", () => {
    renderUi(
      <IconButton asChild icon={Settings} label="Pengaturan">
        <NavLink to="/pengaturan" />
      </IconButton>,
      "/pengaturan",
    );
    const link = screen.getByRole("link", { name: "Pengaturan" });
    expect(link.getAttribute("href")).toBe("/pengaturan");
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(link.querySelector("svg")).not.toBeNull();
  });
});
