import { describe, expect, mock, test } from "bun:test";
import { screen } from "@testing-library/react";
import { t } from "@/i18n/id.ts";
import { renderUi } from "@/test-utils.tsx";
import { DetailPanel, type DetailPanelData } from "./DetailPanel.tsx";

function data(overrides: Partial<DetailPanelData> = {}): DetailPanelData {
  return {
    tier: "sedang",
    meters: [{ label: t.budget.triangles, valueText: "3.388 / 8.000", ratio: 0.42 }],
    rows: [{ label: t.budget.vertex, value: "1.954" }],
    versions: [
      { version: 1, title: "v1 · Bentuk dasar", meta: "2 mnt lalu" },
      { version: 2, title: "v2 · Aset final", meta: "baru saja" },
    ],
    version: 2,
    onVersionChange: () => undefined,
    validation: { errors: 0, warnings: 0 },
    ...overrides,
  };
}

describe("DetailPanel", () => {
  test("region berjudul Detail berisi statistik, versi, dan hasil validasi glTF", () => {
    renderUi(
      <DetailPanel data={data({ validation: { errors: 0, warnings: 2 } })} onCollapse={() => undefined} />,
    );
    const panel = screen.getByRole("region", { name: t.detailPanel.title });
    expect(panel.textContent).toContain("3.388 / 8.000");
    expect(screen.getByRole("radiogroup", { name: t.versions.label })).toBeDefined();
    expect(screen.getByText(t.detailPanel.validation("0", "2"))).toBeDefined();
  });

  test("glTF tidak valid ditulis jelas", () => {
    renderUi(
      <DetailPanel data={data({ validation: { errors: 3, warnings: 0 } })} onCollapse={() => undefined} />,
    );
    expect(screen.getByText(t.detailPanel.validationFailed("3", "0"))).toBeDefined();
  });

  test("bagian Optimasi (frame Tahap 9 F): ukuran, segitiga, dan langkah sebagai pasangan kunci–nilai", () => {
    renderUi(
      <DetailPanel
        data={data({
          optimization: {
            size: "1,9 MB → 412 KB",
            triangles: "13.840 → 11.402",
            steps: "Hapus duplikat · bersihkan",
          },
        })}
        onCollapse={() => undefined}
      />,
    );
    const section = screen.getByRole("region", { name: t.optimization.title });
    const terms = Array.from(section.querySelectorAll("dt"), (term) => term.textContent);
    const values = Array.from(section.querySelectorAll("dd"), (value) => value.textContent);
    expect(terms).toEqual([t.optimization.size, t.optimization.triangles, t.optimization.steps]);
    expect(values).toEqual(["1,9 MB → 412 KB", "13.840 → 11.402", "Hapus duplikat · bersihkan"]);
  });

  test("tanpa ringkasan (versi lama): bagian Optimasi dan baris validasi tidak tampil", () => {
    renderUi(<DetailPanel data={data({ validation: null })} onCollapse={() => undefined} />);
    expect(screen.queryByRole("region", { name: t.optimization.title })).toBeNull();
    expect(screen.queryByText(/glTF/)).toBeNull();
  });

  test("tombol tutup dan pilihan versi memanggil handler", async () => {
    const onCollapse = mock(() => undefined);
    const onVersionChange = mock((_version: number) => undefined);
    const { user } = renderUi(<DetailPanel data={data({ onVersionChange })} onCollapse={onCollapse} />);
    await user.click(screen.getByRole("radio", { name: /v1 · Bentuk dasar/ }));
    await user.click(screen.getByRole("button", { name: t.detailPanel.collapse }));
    expect(onVersionChange).toHaveBeenCalledWith(1);
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });
});
