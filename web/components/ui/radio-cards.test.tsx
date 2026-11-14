import { describe, expect, mock, test } from "bun:test";
import { screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { renderUi } from "@/test-utils.tsx";
import { RadioCards } from "./radio-cards.tsx";

type Preset = "web" | "unity" | "source";

const OPTIONS = [
  { value: "web", title: "Web", description: "GLB terkompresi", meta: "612 KB" },
  { value: "unity", title: "Unity", description: "Tanpa ekstensi kompresi", meta: "≈ 2,4 MB" },
  { value: "source", title: "Sumber", description: "ZIP .blend dan skrip" },
] as const;

function Harness({ onChange }: { onChange: (value: Preset) => void }) {
  const [value, setValue] = useState<Preset>("web");
  return (
    <>
      <h3 id="format">Format</h3>
      <RadioCards
        labelledBy="format"
        value={value}
        options={OPTIONS}
        onValueChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
    </>
  );
}

const checked = (name: string) => screen.getByRole("radio", { name }).getAttribute("aria-checked");

describe("RadioCards", () => {
  test("grup radio berlabel; kartu bernama judulnya, keterangan dan ukurannya jadi deskripsi", () => {
    renderUi(<Harness onChange={() => undefined} />);
    expect(screen.getByRole("radiogroup", { name: "Format" })).toBeDefined();
    const web = screen.getByRole("radio", { name: "Web" });
    expect(checked("Web")).toBe("true");
    const described = (web.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual(["GLB terkompresi", "612 KB"]);
    // Tanpa `meta`: hanya keterangan.
    expect(
      screen.getByRole("radio", { name: "Sumber" }).getAttribute("aria-describedby")?.split(" "),
    ).toHaveLength(1);
  });

  test("klik kartu memilih", async () => {
    const onChange = mock();
    const { user } = renderUi(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: "Unity" }));
    expect(checked("Unity")).toBe("true");
    expect(screen.getByRole("radio", { name: "Unity" }).getAttribute("data-state")).toBe("checked");
    expect(onChange).toHaveBeenCalledWith("unity");
  });

  test("keyboard: Tab ke kartu terpilih, panah bawah memilih kartu berikutnya", async () => {
    const onChange = mock();
    const { user } = renderUi(<Harness onChange={onChange} />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Web" }));
    // Radix memilih saat fokus pindah karena panah; fokusnya dipindah lewat setTimeout (lihat AGENTS §13).
    await user.keyboard("{ArrowDown>}");
    await waitFor(() => expect(checked("Unity")).toBe("true"));
    await user.keyboard("{/ArrowDown}");
    expect(onChange).toHaveBeenLastCalledWith("unity");
  });
});
