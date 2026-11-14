import { describe, expect, mock, test } from "bun:test";
import { act, screen, waitForElementToBeRemoved, within } from "@testing-library/react";
import { renderUi } from "@/test-utils.tsx";
import { notify, ToastCard, Toaster } from "./toast.tsx";

describe("ToastCard", () => {
  test("sukses: judul dan deskripsi, tombol tutup memanggil onClose", async () => {
    const onClose = mock();
    const { user } = renderUi(
      <ToastCard kind="success" title="Aset diekspor" description="peti.glb · 612 KB" onClose={onClose} />,
    );
    expect(screen.getByText("Aset diekspor")).toBeDefined();
    expect(screen.getByText("peti.glb · 612 KB")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Tutup notifikasi" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("gagal memakai ikon danger", () => {
    renderUi(<ToastCard kind="error" title="Build gagal" onClose={() => undefined} />);
    const title = screen.getByText("Build gagal");
    expect(title.parentElement?.parentElement?.querySelector("svg")?.getAttribute("class")).toContain(
      "text-danger-text",
    );
  });

  test("diumumkan lewat wilayah sonner (aria-live polite); kartu tidak membuat live region bersarang", async () => {
    renderUi(<Toaster />);
    act(() => {
      notify.error("Build gagal", "Skrip error di baris 12");
    });
    const region = screen.getByRole("region", { name: /Notifikasi/ });
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(await within(region).findByText("Build gagal")).toBeDefined();
    expect(within(region).queryByRole("alert")).toBeNull();
    expect(within(region).queryByRole("status")).toBeNull();
  });

  test("id tetap: toast dengan id sama diganti, notify.dismiss(id) menutupnya", async () => {
    renderUi(<Toaster />);
    act(() => {
      notify.info("Peti siap direview", undefined, { id: "aset-status:peti" });
      notify.success("Peti selesai", undefined, { id: "aset-status:peti" });
    });
    const region = screen.getByRole("region", { name: /Notifikasi/ });
    expect(await within(region).findByText("Peti selesai")).toBeDefined();
    expect(within(region).queryByText("Peti siap direview")).toBeNull();
    act(() => notify.dismiss("aset-status:peti"));
    await waitForElementToBeRemoved(() => within(region).queryByText("Peti selesai"));
  });
});
