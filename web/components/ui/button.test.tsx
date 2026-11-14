import { describe, expect, mock, test } from "bun:test";
import { screen } from "@testing-library/react";
import { Plus } from "lucide-react";
import { Link } from "react-router";
import { renderUi } from "@/test-utils.tsx";
import { Button } from "./button.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "./menu.tsx";

describe("Button", () => {
  test("bawaannya type=button (tidak mengirim form) dan varian secondary ukuran md", () => {
    renderUi(<Button>Simpan</Button>);
    const button = screen.getByRole("button", { name: "Simpan" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.className).toContain("bg-bg-raised");
    expect(button.className).toContain("h-9");
  });

  test("type eksplisit tetap dihormati", () => {
    renderUi(<Button type="submit">Kirim</Button>);
    expect(screen.getByRole("button", { name: "Kirim" }).getAttribute("type")).toBe("submit");
  });

  test.each([
    ["primary", "bg-accent-solid"],
    ["secondary", "border-border-strong"],
    ["ghost", "text-text-secondary"],
    ["danger", "bg-danger-soft"],
  ] as const)("varian %s memakai token %s", (variant, tokenClass) => {
    renderUi(<Button variant={variant}>Tombol</Button>);
    expect(screen.getByRole("button", { name: "Tombol" }).className).toContain(tokenClass);
  });

  test.each([
    ["md", "16", "h-9"],
    ["sm", "14", "h-7.5"],
  ] as const)("ukuran %s: ikon %s px di depan label, tinggi %s", (size, iconSize, height) => {
    renderUi(
      <Button size={size} icon={Plus}>
        Aset baru
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Aset baru" });
    expect(button.className).toContain(height);
    const icon = button.querySelector("svg");
    expect(icon?.getAttribute("width")).toBe(iconSize);
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(button.firstElementChild).toBe(icon);
  });

  test("className tambahan menimpa kelas varian yang bertabrakan", () => {
    renderUi(<Button className="px-6">Lebar</Button>);
    const { className } = screen.getByRole("button", { name: "Lebar" });
    expect(className).toContain("px-6");
    expect(className).not.toContain("px-3.5");
  });

  test("asChild merender tautan dengan gaya tombol dan ikon di dalamnya", () => {
    renderUi(
      <Button asChild variant="primary" icon={Plus}>
        <a href="/gudang">Buka Gudang</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Buka Gudang" });
    expect(link.className).toContain("bg-accent-solid");
    expect(link.hasAttribute("type")).toBe(false);
    expect(link.querySelector("svg")).not.toBeNull();
  });

  // Opacity 45% diukur di E2E (gaya terhitung); di sini perilakunya.
  test("nonaktif: atribut disabled, klik tidak memanggil onClick", async () => {
    const onClick = mock();
    const { user } = renderUi(
      <Button disabled onClick={onClick}>
        Tidak aktif
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Tidak aktif" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  test("memuat: aria-busy, klik diabaikan, fokus tetap di tombol", async () => {
    const onClick = mock();
    const { user } = renderUi(
      <Button loading icon={Plus} onClick={onClick}>
        Menyimpan…
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Menyimpan…" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.querySelector("svg")?.getAttribute("class")).toContain("animate-spin");
    await user.click(button);
    await user.tab();
    await user.tab({ shift: true });
    await user.keyboard("{Enter}");
    expect(onClick).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
  });

  test("memuat dengan asChild: klik pada tautan router diabaikan", async () => {
    const onClick = mock();
    const { user } = renderUi(
      <Button asChild loading>
        <Link to="/ekspor" onClick={onClick}>
          Ekspor
        </Link>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Ekspor" });
    expect(link.getAttribute("aria-busy")).toBe("true");
    await user.click(link);
    link.focus();
    await user.keyboard("{Enter}");
    expect(onClick).not.toHaveBeenCalled();
  });

  test("memuat sebagai pemicu menu: klik, Enter, dan panah bawah tidak membuka menu", async () => {
    const { user } = renderUi(
      <Menu>
        <MenuTrigger asChild>
          <Button loading>Opsi</Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem>Duplikat</MenuItem>
        </MenuContent>
      </Menu>,
    );
    const trigger = screen.getByRole("button", { name: "Opsi" });
    await user.click(trigger);
    trigger.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    await user.keyboard("{ArrowDown}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});
