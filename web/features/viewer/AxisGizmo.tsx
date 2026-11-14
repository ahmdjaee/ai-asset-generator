import { Toolbar } from "radix-ui";
import { type Ref, useImperativeHandle, useRef } from "react";
import { Tooltip } from "@/components/ui/tooltip.tsx";
import { t } from "@/i18n/id.ts";
import { cn } from "@/lib/utils.ts";
import { AXIS_PRESET, type AxisId, type PresetId, projectAxes } from "./math.ts";
import type { GizmoHandle } from "./ViewerScene.tsx";

type Axis = "x" | "y" | "z";

/** Urutan DOM tetap (urutan fokus panah), tidak ikut berubah saat kamera berputar. */
const HEADS: ReadonlyArray<Readonly<{ id: AxisId; axis: Axis; positive: boolean }>> = [
  { id: "px", axis: "x", positive: true },
  { id: "py", axis: "y", positive: true },
  { id: "pz", axis: "z", positive: true },
  { id: "nx", axis: "x", positive: false },
  { id: "ny", axis: "y", positive: false },
  { id: "nz", axis: "z", positive: false },
];

const AXIS_STYLE: Readonly<
  Record<Axis, Readonly<{ fill: string; hoverFill: string; border: string; stroke: string }>>
> = {
  x: {
    fill: "bg-axis-x",
    hoverFill: "group-hover:bg-axis-x",
    border: "border-axis-x",
    stroke: "stroke-axis-x",
  },
  y: {
    fill: "bg-axis-y",
    hoverFill: "group-hover:bg-axis-y",
    border: "border-axis-y",
    stroke: "stroke-axis-y",
  },
  z: {
    fill: "bg-axis-z",
    hoverFill: "group-hover:bg-axis-z",
    border: "border-axis-z",
    stroke: "stroke-axis-z",
  },
};

/** Ukuran gizmo dan pusatnya (px), sama dengan komponen FigCraft. */
const SIZE = 96;
const CENTER = SIZE / 2;

/**
 * Gizmo sumbu (FigCraft #2464): 96×96, garis sumbu positif 2 px dari pusat, bulatan positif 18 px berlabel
 * (`axis/*` + teks `axis/label` 10 SemiBold), bulatan negatif 12 px `bg/viewport` bergaris 1,5 px warna sumbu dengan
 * opasitas penuh (kontras garis ≥3:1 di kedua tema, WCAG 1.4.11); saat hover bulatan negatif terisi warna sumbu.
 * Setiap bulatan adalah tombol 24×24 (target sentuh) yang membuka sudut cepatnya. Satu pemberhentian Tab; panah
 * memindah fokus antarbulatan dalam urutan tetap X, Y, Z, −X, −Y, −Z.
 *
 * Posisi diperbarui langsung di DOM dari `useFrame` lewat `ref` (tanpa setState per frame). Bulatan yang lebih dekat
 * ke kamera digambar di atas.
 */
export function AxisGizmo({
  ref,
  onSelect,
  className,
}: {
  ref: Ref<GizmoHandle>;
  onSelect: (preset: PresetId) => void;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const heads = useRef(new Map<AxisId, HTMLButtonElement>());
  const lines = useRef(new Map<AxisId, SVGLineElement>());

  useImperativeHandle(
    ref,
    () => ({
      update(view) {
        for (const axis of projectAxes(view)) {
          const head = heads.current.get(axis.id);
          if (head) {
            head.style.transform = `translate(${axis.x.toFixed(2)}px, ${axis.y.toFixed(2)}px)`;
            head.style.zIndex = String(1 + Math.round((axis.depth + 1) * 10));
          }
          const line = lines.current.get(axis.id);
          if (line) {
            line.setAttribute("x2", (CENTER + axis.x).toFixed(2));
            line.setAttribute("y2", (CENTER + axis.y).toFixed(2));
          }
        }
        if (root.current) root.current.style.visibility = "visible";
      },
    }),
    [],
  );

  return (
    <Toolbar.Root
      ref={root}
      aria-label={t.viewer.gizmo.label}
      orientation="horizontal"
      loop
      // Tersembunyi sampai frame pertama menempatkan bulatan sesuai kamera.
      className={cn("invisible relative size-24", className)}
    >
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
      >
        {HEADS.filter((head) => head.positive).map((head) => (
          <line
            key={head.id}
            ref={(element) => {
              if (element) lines.current.set(head.id, element);
              else lines.current.delete(head.id);
            }}
            x1={CENTER}
            y1={CENTER}
            x2={CENTER}
            y2={CENTER}
            strokeWidth={2}
            className={AXIS_STYLE[head.axis].stroke}
          />
        ))}
      </svg>
      {HEADS.map((head) => {
        const label = t.viewer.gizmo.axes[head.id];
        const style = AXIS_STYLE[head.axis];
        return (
          <Tooltip key={head.id} label={label}>
            <Toolbar.Button
              ref={(element) => {
                if (element) heads.current.set(head.id, element);
                else heads.current.delete(head.id);
              }}
              aria-label={label}
              onClick={() => onSelect(AXIS_PRESET[head.id])}
              className="group absolute top-9 left-9 flex size-6 items-center justify-center rounded-full"
            >
              {head.positive ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-4.5 items-center justify-center rounded-full font-semibold text-[10px] text-axis-label leading-none",
                    style.fill,
                  )}
                >
                  {head.axis.toUpperCase()}
                </span>
              ) : (
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-3 rounded-full border-[1.5px] bg-bg-viewport",
                    style.border,
                    style.hoverFill,
                  )}
                />
              )}
            </Toolbar.Button>
          </Tooltip>
        );
      })}
    </Toolbar.Root>
  );
}
