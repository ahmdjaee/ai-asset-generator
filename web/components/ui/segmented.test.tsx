import { describe, expect, mock, test } from "bun:test";
import { screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { renderUi } from "@/test-utils.tsx";
import { Segmented, type SegmentedOption } from "./segmented.tsx";

const OPTIONS = [
  { value: "a", label: "Satu" },
  { value: "b", label: "Dua" },
  { value: "c", label: "Tiga" },
] as const;

function Harness({
  onChange,
  options = OPTIONS,
  variant,
}: {
  onChange: (value: string) => void;
  options?: readonly SegmentedOption<"a" | "b" | "c">[];
  variant?: "track" | "toolbar" | "icons";
}) {
  const [value, setValue] = useState<"a" | "b" | "c">("b");
  return (
    <Segmented
      label="Pilihan"
      value={value}
      options={options}
      {...(variant ? { variant } : {})}
      onValueChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

const checked = (name: string) => screen.getByRole("radio", { name }).getAttribute("aria-checked");

describe("Segmented", () => {
  // Warna dan garis pilihan terpilih diukur di E2E (gaya terhitung terhadap token); di sini hanya statusnya.
  test("grup radio bernama; pilihan terpilih tercentang dengan data-state yang dipakai gayanya", () => {
    renderUi(<Harness onChange={() => undefined} />);
    expect(screen.getByRole("radiogroup", { name: "Pilihan" })).toBeDefined();
    expect(checked("Dua")).toBe("true");
    expect(screen.getByRole("radio", { name: "Dua" }).getAttribute("data-state")).toBe("checked");
  });

  // Radix memilih saat fokus berpindah karena panah ditekan; fokusnya dipindah lewat setTimeout, jadi tombol
  // ditahan (`{Key>}`) sampai pilihan berubah, seperti di browser sungguhan.
  async function press(user: ReturnType<typeof renderUi>["user"], key: string, expected: string) {
    await user.keyboard(`{${key}>}`);
    await waitFor(() => expect(checked(expected)).toBe("true"));
    await user.keyboard(`{/${key}}`);
  }

  test("keyboard: Tab ke pilihan terpilih, panah kanan/kiri memilih", async () => {
    const onChange = mock();
    const { user } = renderUi(<Harness onChange={onChange} />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Dua" }));
    await press(user, "ArrowRight", "Tiga");
    await press(user, "ArrowLeft", "Dua");
    await press(user, "ArrowLeft", "Satu");
    expect(onChange).toHaveBeenLastCalledWith("a");
  });

  test("klik memilih", async () => {
    const onChange = mock();
    const { user } = renderUi(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: "Satu" }));
    expect(checked("Satu")).toBe("true");
    expect(onChange).toHaveBeenCalledWith("a");
  });

  describe("varian toolbar dengan pilihan nonaktif (mode viewer)", () => {
    const WITH_DISABLED = [{ value: "a", label: "Satu", disabled: true }, OPTIONS[1], OPTIONS[2]] as const;

    test("pilihan nonaktif tidak bisa diklik dan diumumkan nonaktif", async () => {
      const onChange = mock();
      const { user } = renderUi(<Harness onChange={onChange} options={WITH_DISABLED} variant="toolbar" />);
      const disabled = screen.getByRole("radio", { name: "Satu" });
      expect(disabled.hasAttribute("disabled")).toBe(true);
      await user.click(disabled);
      expect(checked("Satu")).toBe("false");
      expect(onChange).not.toHaveBeenCalled();
    });

    test("panah keyboard melewati pilihan nonaktif", async () => {
      const onChange = mock();
      const { user } = renderUi(<Harness onChange={onChange} options={WITH_DISABLED} variant="toolbar" />);
      await user.tab();
      await press(user, "ArrowRight", "Tiga");
      // Dari "Tiga", panah kanan berputar ke awal dan melompati "Satu" yang nonaktif.
      await press(user, "ArrowRight", "Dua");
      expect(onChange).not.toHaveBeenCalledWith("a");
    });

    test("toolbar tanpa trek: tanpa garis dan latar grup", () => {
      renderUi(<Harness onChange={() => undefined} variant="toolbar" />);
      const group = screen.getByRole("radiogroup", { name: "Pilihan" });
      expect(group.className).not.toContain("bg-bg-sunken");
      expect(screen.getByRole("radio", { name: "Dua" }).className).toContain("text-label");
    });
  });

  describe("varian icons (Tampilan Gudang)", () => {
    const ICONS = [
      { value: "a", label: <svg aria-hidden />, name: "Grid" },
      { value: "b", label: <svg aria-hidden />, name: "Daftar" },
    ] as const;

    test("pilihan ikon bernama lewat `name` dan memakai trek", () => {
      renderUi(<Harness onChange={() => undefined} options={ICONS} variant="icons" />);
      expect(screen.getByRole("radiogroup", { name: "Pilihan" }).className).toContain("bg-bg-sunken");
      const list = screen.getByRole("radio", { name: "Daftar" });
      expect(list.getAttribute("aria-checked")).toBe("true");
      expect(list.className).toContain("w-7");
    });

    test("tooltip menampilkan nama pilihan saat difokus dengan keyboard", async () => {
      const { user } = renderUi(<Harness onChange={() => undefined} options={ICONS} variant="icons" />);
      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Daftar" }));
      expect((await screen.findByRole("tooltip")).textContent).toContain("Daftar");
    });
  });
});
