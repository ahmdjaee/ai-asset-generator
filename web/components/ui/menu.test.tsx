import { describe, expect, mock, test } from "bun:test";
import { screen, waitFor } from "@testing-library/react";
import { Copy, Trash2 } from "lucide-react";
import { useState } from "react";
import { renderUi } from "@/test-utils.tsx";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "./menu.tsx";

function Harness({ onDuplicate, onOutside }: { onDuplicate: () => void; onOutside?: () => void }) {
  const [angle, setAngle] = useState("3/4");
  return (
    <>
      <button type="button" onClick={onOutside}>
        Di luar
      </button>
      <Menu>
        <MenuTrigger>Opsi</MenuTrigger>
        <MenuContent>
          <MenuItem icon={Copy} hint="D" onSelect={onDuplicate}>
            Duplikat
          </MenuItem>
          <MenuItem icon={Trash2} danger>
            Hapus
          </MenuItem>
          <MenuItem disabled>Arsipkan</MenuItem>
          <MenuSeparator />
          <MenuRadioGroup value={angle} onValueChange={setAngle}>
            <MenuRadioItem value="3/4" hint="bawaan">
              3/4
            </MenuRadioItem>
            <MenuRadioItem value="depan">Depan</MenuRadioItem>
          </MenuRadioGroup>
        </MenuContent>
      </Menu>
    </>
  );
}

describe("Menu", () => {
  test("dibuka dengan keyboard; item, item bahaya, dan item nonaktif punya peran yang benar", async () => {
    const { user } = renderUi(<Harness onDuplicate={() => undefined} />);
    screen.getByRole("button", { name: "Opsi" }).focus();
    await user.keyboard("{Enter}");
    const menu = await screen.findByRole("menu");
    expect(menu.className).toContain("rounded-[10px]");
    expect(screen.getByRole("menuitem", { name: "Duplikat D" })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: "Hapus" }).className).toContain("text-danger-text");
    expect(screen.getByRole("menuitem", { name: "Arsipkan" }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("separator")).toBeDefined();
  });

  test("memilih item memanggil onSelect dan menutup menu", async () => {
    const onDuplicate = mock();
    const { user } = renderUi(<Harness onDuplicate={onDuplicate} />);
    await user.click(screen.getByRole("button", { name: "Opsi" }));
    await user.click(await screen.findByRole("menuitem", { name: "Duplikat D" }));
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  test("tidak modal: isi app tetap terbaca pembaca layar, klik di luar menutup menu dan sampai ke sasarannya", async () => {
    const onOutside = mock();
    const { user } = renderUi(<Harness onDuplicate={() => undefined} onOutside={onOutside} />);
    await user.click(screen.getByRole("button", { name: "Opsi" }));
    await screen.findByRole("menu");
    // Menu modal memberi `aria-hidden` pada isi app, sehingga tombol ini hilang dari pohon aksesibilitas.
    const outside = screen.getByRole("button", { name: "Di luar" });
    expect(outside.closest("[aria-hidden='true']")).toBeNull();
    await user.click(outside);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(onOutside).toHaveBeenCalledTimes(1);
  });

  test("Escape menutup menu dan mengembalikan fokus ke pemicu", async () => {
    const { user } = renderUi(<Harness onDuplicate={() => undefined} />);
    const trigger = screen.getByRole("button", { name: "Opsi" });
    await user.click(trigger);
    await screen.findByRole("menu");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  test("item pilihan memakai menuitemradio dengan aria-checked", async () => {
    const { user } = renderUi(<Harness onDuplicate={() => undefined} />);
    await user.click(screen.getByRole("button", { name: "Opsi" }));
    expect(
      (await screen.findByRole("menuitemradio", { name: "3/4 bawaan" })).getAttribute("aria-checked"),
    ).toBe("true");
    await user.click(screen.getByRole("menuitemradio", { name: "Depan" }));
    await user.click(screen.getByRole("button", { name: "Opsi" }));
    expect((await screen.findByRole("menuitemradio", { name: "Depan" })).getAttribute("aria-checked")).toBe(
      "true",
    );
  });
});
