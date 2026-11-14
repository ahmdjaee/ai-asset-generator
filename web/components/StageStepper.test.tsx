import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { type StageProgress, StageStepper } from "./StageStepper.tsx";

const currentStep = () => document.querySelector('[aria-current="step"]')?.textContent ?? null;

describe("StageStepper", () => {
  test.each([
    ["new", null, 0],
    ["base", "Bentuk dasar (sedang dikerjakan)", 0],
    ["final", "Aset final (sedang dikerjakan)", 1],
    ["done", null, 2],
  ] as const satisfies ReadonlyArray<readonly [StageProgress, string | null, number]>)(
    "%s: langkah aktif %s, %d langkah selesai",
    (stage, current, done) => {
      render(<StageStepper stage={stage} />);
      const list = screen.getByRole("list", { name: "Tahap aset" });
      expect(list.querySelectorAll("li").length).toBe(2);
      expect(currentStep()?.replace(/^\d/, "") ?? null).toBe(current);
      expect(screen.queryAllByText("(selesai)", { exact: false }).length).toBe(done);
    },
  );

  test("tahap selesai mengganti nomor dengan ikon centang", () => {
    render(<StageStepper stage="final" />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]?.querySelector("svg")).not.toBeNull();
    expect(items[1]?.textContent).toContain("2");
  });
});
