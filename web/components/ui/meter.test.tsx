import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Meter } from "./meter.tsx";

describe("Meter", () => {
  test("elemen meter bernama label dengan nilai teks, rasio dipotong 0..1", () => {
    render(<Meter label="Ukuran web.glb" valueText="1,7 MB / 1,5 MB maks" ratio={1.13} tone="danger" />);
    const meter = screen.getByRole("meter", { name: "Ukuran web.glb" }) as HTMLMeterElement;
    expect(meter.getAttribute("aria-valuetext")).toBe("1,7 MB / 1,5 MB maks");
    expect(meter.value).toBe(1);
    expect(meter.className).toContain("bg-danger-text");
    expect(screen.getByText("1,7 MB / 1,5 MB maks").className).toContain("text-danger-text");
  });

  test("nada normal memakai accent/solid", () => {
    render(<Meter label="Segitiga" valueText="3.388 / 8.000" ratio={0.4235} />);
    const meter = screen.getByRole("meter", { name: "Segitiga" }) as HTMLMeterElement;
    expect(meter.value).toBeCloseTo(0.4235);
    expect(meter.className).toContain("bg-accent-solid");
  });
});
