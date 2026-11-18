import { describe, expect, mock, test } from "bun:test";
import { screen, waitForElementToBeRemoved } from "@testing-library/react";
import { useState } from "react";
import { renderUi } from "@/test-utils.tsx";
import { Dropdown } from "./dropdown.tsx";

const OPTIONS = [
  { value: "all", label: "Semua" },
  { value: "ringan", label: "Ringan" },
  { value: "sedang", label: "Sedang" },
] as const;

function Harness({ onChange }: { onChange: (value: string) => void }) {
  const [value, setValue] = useState<(typeof OPTIONS)[number]["value"]>("all");
  return (
    <Dropdown
      prefix="Tier"
      value={value}
      options={OPTIONS}
      onValueChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe("Dropdown", () => {
  test("pemicu menampilkan awalan dan nilai terpilih; namanya dari isinya", () => {
    renderUi(<Harness onChange={() => undefined} />);
    const trigger = screen.getByRole("button", { name: "Tier Semua" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  test("menu berisi pilihan radio dengan centang di pilihan sekarang; memilih mengganti nilai dan menutup menu", async () => {
    const onChange = mock();
    const { user } = renderUi(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Tier Semua" }));
    expect(screen.getByRole("menuitemradio", { name: "Semua" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemradio", { name: "Sedang" }).getAttribute("aria-checked")).toBe("false");
    await user.click(screen.getByRole("menuitemradio", { name: "Sedang" }));
    expect(onChange).toHaveBeenCalledWith("sedang");
    if (screen.queryByRole("menu") !== null)
      await waitForElementToBeRemoved(() => screen.queryByRole("menu"));
    expect(screen.getByRole("button", { name: "Tier Sedang" })).toBeDefined();
  });

  test("keyboard: Enter membuka, panah bawah ke pilihan berikutnya, Enter memilih", async () => {
    const onChange = mock();
    const { user } = renderUi(<Harness onChange={onChange} />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Tier Semua" }));
    await user.keyboard("{Enter}");
    await screen.findByRole("menu");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("ringan");
  });

  test("tanpa awalan: nama dari `label` + nilai, pilihan kosong redup, pemicu selebar sel", async () => {
    const onChange = mock();
    const { user } = renderUi(
      <Dropdown
        label="Normal map, Ringan"
        value="none"
        options={[
          { value: "none", label: "Tidak ada", muted: true },
          { value: "1024", label: "1024 px" },
        ]}
        onValueChange={onChange}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Normal map, Ringan: Tidak ada" });
    expect(trigger.className).toContain("w-full");
    expect(screen.getByText("Tidak ada").className).toContain("text-text-secondary");
    await user.click(trigger);
    await user.click(screen.getByRole("menuitemradio", { name: "1024 px" }));
    expect(onChange).toHaveBeenCalledWith("1024");
  });
});
