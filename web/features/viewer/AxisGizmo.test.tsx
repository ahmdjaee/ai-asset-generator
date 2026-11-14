import { describe, expect, mock, test } from "bun:test";
import { act, screen } from "@testing-library/react";
import { createRef } from "react";
import { Matrix4 } from "three";
import { t } from "@/i18n/id.ts";
import { renderUi } from "@/test-utils.tsx";
import { AxisGizmo } from "./AxisGizmo.tsx";
import { type AxisId, GIZMO_RADIUS, type PresetId } from "./math.ts";
import type { GizmoHandle } from "./ViewerScene.tsx";

const axes = t.viewer.gizmo.axes;

function renderGizmo() {
  const onSelect = mock((_preset: PresetId) => undefined);
  const ref = createRef<GizmoHandle>();
  const view = renderUi(<AxisGizmo ref={ref} onSelect={onSelect} />);
  return { ...view, onSelect, ref };
}

const head = (id: AxisId) => screen.getByRole("button", { name: axes[id] });

describe("AxisGizmo", () => {
  test("toolbar berlabel dengan enam bulatan; hanya satu yang bisa dicapai lewat Tab", () => {
    renderGizmo();
    const toolbar = screen.getByRole("toolbar", { name: t.viewer.gizmo.label });
    const buttons = Array.from(toolbar.querySelectorAll("button"));
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      axes.px,
      axes.py,
      axes.pz,
      axes.nx,
      axes.ny,
      axes.nz,
    ]);
    // Roving focus: sebelum ada bulatan yang difokus, toolbar sendiri satu-satunya pemberhentian Tab (fokusnya
    // diteruskan ke bulatan pertama); setelah itu bulatan terakhir yang difokus.
    expect(toolbar.tabIndex).toBe(0);
    expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(0);
  });

  test("panah memindah fokus antarbulatan dalam urutan tetap; hanya bulatan terfokus yang bisa di-Tab", async () => {
    const { user } = renderGizmo();
    head("px").focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(head("py"));
    const toolbar = screen.getByRole("toolbar", { name: t.viewer.gizmo.label });
    const tabbable = Array.from(toolbar.querySelectorAll("button")).filter((button) => button.tabIndex === 0);
    expect(tabbable.map((button) => button.getAttribute("aria-label"))).toEqual([axes.py]);
  });

  test("klik bulatan membuka sudut cepat sumbu itu", async () => {
    const { user, onSelect } = renderGizmo();
    await user.click(head("py"));
    await user.click(head("nz"));
    await user.click(head("px"));
    expect(onSelect.mock.calls).toEqual([["top"], ["back"], ["right"]]);
  });

  test("tersembunyi sampai frame pertama; update menempatkan bulatan sesuai kamera", () => {
    const { ref } = renderGizmo();
    const toolbar = screen.getByRole("toolbar", { name: t.viewer.gizmo.label });
    expect(toolbar.className).toContain("invisible");
    expect(toolbar.style.visibility).toBe("");
    // Tampak depan: matriks view tanpa rotasi.
    act(() => ref.current?.update(new Matrix4().elements));
    expect(toolbar.style.visibility).toBe("visible");
    expect(head("px").style.transform).toBe(`translate(${GIZMO_RADIUS.toFixed(2)}px, 0.00px)`);
    expect(head("py").style.transform).toBe(`translate(0.00px, ${(-GIZMO_RADIUS).toFixed(2)}px)`);
    // +Z mengarah ke kamera: digambar di atas −Z.
    expect(Number(head("pz").style.zIndex)).toBeGreaterThan(Number(head("nz").style.zIndex));
  });
});
