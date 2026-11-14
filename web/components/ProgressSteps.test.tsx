import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderUi } from "@/test-utils.tsx";
import { type ProgressStep, ProgressSteps } from "./ProgressSteps.tsx";

const RUNNING: ProgressStep[] = [
  { id: "a", label: "Menulis skrip", status: "done", duration: "12 dtk" },
  { id: "b", label: "Render contact sheet", status: "running" },
  { id: "c", label: "Cek budget", status: "pending" },
];

describe("ProgressSteps", () => {
  test("berjalan: daftar terbuka, tiap langkah menyebut statusnya untuk pembaca layar", () => {
    renderUi(<ProgressSteps title="Membuat bentuk dasar v2" meta="1 mnt 12 dtk" steps={RUNNING} />);
    const toggle = screen.getByRole("button", { name: /Membuat bentuk dasar v2/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const items = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toEqual([
      "Menulis skrip (selesai)12 dtk",
      "Render contact sheet (sedang berjalan)",
      "Cek budget (menunggu)",
    ]);
  });

  test("selesai: tertutup; Enter membuka dan menutup daftar", async () => {
    const done = RUNNING.map((step) => ({ ...step, status: "done" as const }));
    const { user } = renderUi(
      <ProgressSteps title="Bentuk dasar v1 selesai" meta="4 langkah" steps={done} />,
    );
    const toggle = screen.getByRole("button", { name: /Bentuk dasar v1 selesai/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("list")).toBeNull();
    await user.tab();
    await user.keyboard("{Enter}");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("listitem").length).toBe(3);
    await user.keyboard("{Enter}");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  test("mengikuti status setelah dirender: tertutup saat selesai, terbuka lagi saat proses baru berjalan", () => {
    const done = RUNNING.map((step) => ({ ...step, status: "done" as const }));
    // `render` langsung (tanpa pembungkus) supaya `rerender` memperbarui komponen yang sama, bukan memasang ulang.
    const view = render(<ProgressSteps title="Bentuk dasar" steps={RUNNING} />);
    const toggle = () => screen.getByRole("button", { name: /Bentuk dasar/ });
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    view.rerender(<ProgressSteps title="Bentuk dasar" steps={done} />);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    view.rerender(<ProgressSteps title="Bentuk dasar" steps={RUNNING} />);
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });

  test("pilihan pengguna bertahan selama status sama, lalu kembali ke bawaan saat status berubah", async () => {
    const user = userEvent.setup();
    const done = RUNNING.map((step) => ({ ...step, status: "done" as const }));
    const view = render(<ProgressSteps title="Bentuk dasar" steps={RUNNING} />);
    const toggle = () => screen.getByRole("button", { name: /Bentuk dasar/ });
    await user.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    // Langkah yang sama dengan durasi baru: status keseluruhan tetap berjalan, daftar tetap tertutup.
    const later = RUNNING.map((step) => (step.id === "b" ? { ...step, duration: "8 dtk" } : step));
    view.rerender(<ProgressSteps title="Bentuk dasar" steps={later} />);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    view.rerender(<ProgressSteps title="Bentuk dasar" steps={done} />);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    view.rerender(<ProgressSteps title="Bentuk dasar" steps={RUNNING} />);
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });

  test("langkah gagal membuat kepala memakai ikon danger", () => {
    renderUi(
      <ProgressSteps
        title="Build gagal"
        steps={[{ id: "a", label: "Build gagal: skrip error", status: "failed" }]}
      />,
    );
    const toggle = screen.getByRole("button", { name: /Build gagal/ });
    expect(toggle.querySelector("svg")?.getAttribute("class")).toContain("text-danger-text");
    expect(screen.getByText(/\(gagal\)/)).toBeDefined();
  });

  test("dihentikan: ikon square tersier, label sekunder; daftar tertutup walau ada langkah menunggu", () => {
    renderUi(
      <ProgressSteps
        title="Build bentuk dasar dihentikan"
        meta="48 dtk"
        steps={[
          { id: "a", label: "Menulis skrip", status: "done", duration: "12 dtk" },
          { id: "b", label: "Build dihentikan", status: "stopped" },
          { id: "c", label: "Render contact sheet", status: "pending" },
        ]}
      />,
    );
    const toggle = screen.getByRole("button", { name: /Build bentuk dasar dihentikan/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const headIcon = toggle.querySelector("svg")?.getAttribute("class") ?? "";
    expect(headIcon).toContain("lucide-square");
    expect(headIcon).toContain("text-text-tertiary");
    expect(headIcon).not.toContain("animate-spin");
    fireEvent.click(toggle);
    const stopped = screen.getByText("Build dihentikan");
    expect(stopped.textContent).toBe("Build dihentikan (dihentikan)");
    expect(stopped.getAttribute("class")).toContain("text-text-secondary");
    expect(stopped.parentElement?.querySelector("svg")?.getAttribute("class")).toContain(
      "text-text-tertiary",
    );
  });
});
