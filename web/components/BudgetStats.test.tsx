import { describe, expect, test } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import { BudgetStats } from "./BudgetStats.tsx";

describe("BudgetStats", () => {
  test("judul, tier, dua meter, dan baris detail sebagai daftar definisi", () => {
    render(
      <BudgetStats
        tier="sedang"
        meters={[
          { label: "Segitiga", valueText: "3.388 / 8.000", ratio: 0.42 },
          { label: "Ukuran web.glb", valueText: "164 KB / 1,5 MB", ratio: 0.11 },
        ]}
        rows={[
          { label: "Vertex", value: "1.954" },
          { label: "Dimensi", value: "0,65 × 0,44 × 0,53 m" },
        ]}
      />,
    );
    const region = screen.getByRole("region", { name: "Anggaran tier" });
    expect(within(region).getByRole("heading", { name: "Anggaran tier" })).toBeDefined();
    expect(within(region).getByText("Sedang")).toBeDefined();
    expect(within(region).getAllByRole("meter").length).toBe(2);
    expect(
      within(region)
        .getAllByRole("term")
        .map((item) => item.textContent),
    ).toEqual(["Vertex", "Dimensi"]);
    expect(
      within(region)
        .getAllByRole("definition")
        .map((item) => item.textContent),
    ).toEqual(["1.954", "0,65 × 0,44 × 0,53 m"]);
  });
});
