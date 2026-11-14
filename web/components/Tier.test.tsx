import { describe, expect, mock, test } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import { renderUi } from "@/test-utils.tsx";
import { DEFAULT_TIERS } from "../../shared/limits.ts";
import { TierIndicator, TierInfo, TierPicker, textureLabel, tierSummary } from "./Tier.tsx";

/** Status bar dekoratif (`aria-hidden`, tanpa role): dibaca dari `data-state` yang juga menentukan warnanya. */
const barStates = (element: HTMLElement) =>
  Array.from(element.querySelectorAll("[aria-hidden] > [data-state]"), (bar) =>
    bar.getAttribute("data-state"),
  );

describe("TierIndicator", () => {
  test.each([
    ["ringan", "Ringan", 1],
    ["sedang", "Sedang", 2],
    ["maksimal", "Maksimal", 3],
  ] as const)("%s: label %s, %d bar terisi (tingkat dari jumlah bar, bukan warna)", (tier, label, bars) => {
    render(<TierIndicator tier={tier} />);
    const indicator = screen.getByText(label);
    expect(barStates(indicator)).toEqual([0, 1, 2].map((index) => (index < bars ? "filled" : "empty")));
  });
});

describe("TierPicker", () => {
  test("grup radio Tier; panah kanan memilih tier berikutnya", async () => {
    const onChange = mock();
    const { user } = renderUi(<TierPicker value="sedang" onValueChange={onChange} />);
    expect(screen.getByRole("radiogroup", { name: "Tier" })).toBeDefined();
    expect(screen.getByRole("radio", { name: "Sedang" }).getAttribute("aria-checked")).toBe("true");
    await user.tab();
    await user.keyboard("{ArrowRight>}");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("maksimal"));
    await user.keyboard("{/ArrowRight}");
  });
});

describe("info tier", () => {
  test("ringkasan Sedang dari budget tier", () => {
    expect(tierSummary("sedang", DEFAULT_TIERS.sedang)).toBe(
      "Sedang — target 8k segitiga, tekstur 1K, file ±800 KB. Cocok untuk game PC, web, dan AR.",
    );
    expect(tierSummary("ringan", DEFAULT_TIERS.ringan)).toContain(
      "target 2k segitiga, tekstur 512, file ±150 KB",
    );
    expect(tierSummary("maksimal", DEFAULT_TIERS.maksimal)).toContain("tekstur 2K, file ±3 MB");
  });

  test("tier tanpa ukuran atlas warna memakai ukuran bake bawaan (512), bukan 0", () => {
    const budget = { ...DEFAULT_TIERS.sedang, textures: {} };
    expect(tierSummary("sedang", budget)).toContain("tekstur 512,");
  });

  test("label tekstur", () => {
    expect(textureLabel(512)).toBe("512");
    expect(textureLabel(1024)).toBe("1K");
    expect(textureLabel(2048)).toBe("2K");
  });

  test("baris info memakai ikon info dan teks Caption", () => {
    render(<TierInfo tier="sedang" budget={DEFAULT_TIERS.sedang} />);
    const line = screen.getByText(/Sedang — target 8k/).parentElement;
    expect(line?.className).toContain("text-caption");
    expect(line?.querySelector("svg")).not.toBeNull();
  });
});
