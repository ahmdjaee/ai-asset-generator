import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Badge, type BadgeTone } from "./badge.tsx";

describe("Badge", () => {
  test.each([
    ["neutral", "Bentuk dasar", "bg-bg-active"],
    ["warning", "Perlu review", "bg-warning-soft"],
    ["accent", "Membuat…", "bg-accent-soft"],
    ["success", "Final", "bg-success-soft"],
    ["danger", "Gagal", "bg-danger-soft"],
  ] as const satisfies ReadonlyArray<readonly [BadgeTone, string, string]>)(
    "nada %s: teks %s di latar %s, titik dekoratif tersembunyi",
    (tone, label, background) => {
      render(<Badge tone={tone}>{label}</Badge>);
      const badge = screen.getByText(label);
      expect(badge.className).toContain(background);
      expect(badge.querySelector("[aria-hidden]")).not.toBeNull();
    },
  );
});
