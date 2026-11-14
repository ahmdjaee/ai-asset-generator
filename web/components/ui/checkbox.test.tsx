import { describe, expect, mock, test } from "bun:test";
import { screen } from "@testing-library/react";
import { useState } from "react";
import { renderUi } from "@/test-utils.tsx";
import { Checkbox } from "./checkbox.tsx";

function Harness({
  onChange,
  disabled = false,
}: {
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <Checkbox
      aria-label="Pilih Peti harta kayu"
      checked={checked}
      disabled={disabled}
      onCheckedChange={(next) => {
        const value = next === true;
        setChecked(value);
        onChange(value);
      }}
    />
  );
}

describe("Checkbox", () => {
  test("kotak centang bernama; klik dan Spasi mengganti status", async () => {
    const onChange = mock();
    const { user } = renderUi(<Harness onChange={onChange} />);
    const box = screen.getByRole("checkbox", { name: "Pilih Peti harta kayu" });
    expect(box.getAttribute("aria-checked")).toBe("false");
    await user.click(box);
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect(box.getAttribute("data-state")).toBe("checked");
    await user.keyboard(" ");
    expect(box.getAttribute("aria-checked")).toBe("false");
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  test("nonaktif: tidak bisa difokus atau diklik", async () => {
    const onChange = mock();
    const { user } = renderUi(<Harness onChange={onChange} disabled />);
    const box = screen.getByRole("checkbox", { name: "Pilih Peti harta kayu" });
    expect(box.hasAttribute("disabled")).toBe(true);
    await user.click(box);
    await user.tab();
    expect(document.activeElement).not.toBe(box);
    expect(onChange).not.toHaveBeenCalled();
  });
});
