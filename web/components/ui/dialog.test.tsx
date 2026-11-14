import { describe, expect, test } from "bun:test";
import { screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { Button } from "@/components/ui/button.tsx";
import { renderUi } from "@/test-utils.tsx";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "./dialog.tsx";

function ConfirmDelete() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Hapus aset</Button>
      </DialogTrigger>
      <DialogContent title="Hapus aset?" description="Peti harta kayu akan dihapus permanen.">
        <DialogFooter>
          <DialogClose asChild>
            <Button>Batal</Button>
          </DialogClose>
          <Button variant="danger">Hapus</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

describe("Dialog", () => {
  test("terbuka dari pemicu: nama dan deskripsi dari judul, fokus awal di isi, bukan tombol tutup", async () => {
    const { user } = renderUi(<ConfirmDelete />);
    await user.click(screen.getByRole("button", { name: "Hapus aset" }));
    const dialog = await screen.findByRole("dialog", { name: "Hapus aset?" });
    expect(dialog.getAttribute("aria-describedby")).not.toBeNull();
    expect(screen.getByText("Peti harta kayu akan dihapus permanen.")).toBeDefined();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Batal" }));
  });

  test("Escape menutup dan mengembalikan fokus ke pemicu", async () => {
    const { user } = renderUi(<ConfirmDelete />);
    const trigger = screen.getByRole("button", { name: "Hapus aset" });
    await user.click(trigger);
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  test("fokus awal melewati kontrol tersembunyi, nonaktif, atau di dalam inert", async () => {
    const { user } = renderUi(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Lampirkan</Button>
        </DialogTrigger>
        <DialogContent title="Lampiran">
          <input type="hidden" name="aset" defaultValue="peti" />
          <input type="file" hidden aria-label="Pilih file" />
          <div inert>
            <Button>Di dalam inert</Button>
          </div>
          <Button disabled>Nonaktif</Button>
          <DialogFooter>
            <Button>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    await user.click(screen.getByRole("button", { name: "Lampirkan" }));
    await screen.findByRole("dialog", { name: "Lampiran" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Simpan" }));
  });

  test("ref dari pemanggil tetap terpasang dan fokus awal tetap jatuh ke isi dialog", async () => {
    const ref = createRef<HTMLDivElement>();
    const { user } = renderUi(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Buka</Button>
        </DialogTrigger>
        <DialogContent ref={ref} title="Judul">
          <DialogFooter>
            <Button>Oke</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    await user.click(screen.getByRole("button", { name: "Buka" }));
    const dialog = await screen.findByRole("dialog", { name: "Judul" });
    expect<HTMLElement | null>(ref.current).toBe(dialog);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Oke" }));
  });

  test("tombol Tutup di pojok menutup dialog", async () => {
    const { user } = renderUi(<ConfirmDelete />);
    await user.click(screen.getByRole("button", { name: "Hapus aset" }));
    await user.click(await screen.findByRole("button", { name: "Tutup" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
