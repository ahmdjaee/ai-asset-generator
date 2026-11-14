import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { AccountChip } from "./AccountChip.tsx";

describe("AccountChip", () => {
  test("nama dan keterangan; avatar dekoratif", () => {
    const { container } = render(<AccountChip name="Akun Claude" detail="Login lewat Claude Code" />);
    expect(screen.getByText("Akun Claude").className).toContain("text-label");
    expect(screen.getByText("Login lewat Claude Code").className).toContain("text-text-tertiary");
    expect(container.querySelector('[aria-hidden="true"] svg, [aria-hidden] svg')).not.toBeNull();
  });
});
