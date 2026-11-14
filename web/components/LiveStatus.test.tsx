import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { LiveStatus } from "./LiveStatus.tsx";

describe("LiveStatus", () => {
  test("region dipasang kosong, lalu teksnya diisi: pembaca layar mengumumkannya sebagai perubahan", () => {
    const atAttach: (string | null | undefined)[] = [];
    render(
      <div
        ref={(element) => {
          // Ref induk dipasang setelah anaknya, sebelum efek: isi region saat pertama masuk DOM.
          if (element) atAttach.push(element.querySelector('[role="status"]')?.textContent);
        }}
      >
        <LiveStatus text="Memuat model…" />
      </div>,
    );
    expect(atAttach).toEqual([""]);
    expect(screen.getByRole("status").textContent).toBe("Memuat model…");
  });

  test("region tetap elemen yang sama saat teksnya berubah", () => {
    const { rerender } = render(<LiveStatus text="Memuat model…" />);
    const region = screen.getByRole("status");
    rerender(<LiveStatus text="Model gagal dimuat" />);
    expect(screen.getByRole("status")).toBe(region);
    expect(region.textContent).toBe("Model gagal dimuat");
    rerender(<LiveStatus text="" />);
    expect(region.textContent).toBe("");
  });
});
