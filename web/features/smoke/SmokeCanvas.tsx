import { CameraControls, GizmoHelper, GizmoViewport, Grid } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { tSmoke } from "@/i18n/id.ts";
import { installThreeConsoleFilter } from "@/lib/three-console.ts";
import { COLOR_VALUES, type ColorToken } from "@/styles/tokens.ts";
import { useTheme } from "@/theme.ts";

installThreeConsoleFilter();

/**
 * Kubus uji R3F + drei (CameraControls, Grid, GizmoHelper). Membuktikan three/R3F/drei berjalan di Vite 8 dan
 * React 19 tanpa aset dari CDN. Warna diambil dari token tema aktif.
 *
 * drei `<Bounds>` sengaja tidak dipakai: ia memanggil `controls.target`, yang tidak dimiliki CameraControls
 * (error setiap frame). Viewer Tahap 8 memakai `CameraControls.fitToBox` untuk membingkai model.
 */
export function SmokeCanvas() {
  const { resolved } = useTheme();
  const color = (token: ColorToken) => COLOR_VALUES[token][resolved];
  return (
    <div
      role="img"
      aria-label={tSmoke.canvasLabel}
      className="h-80 overflow-hidden rounded-xl border border-border-default bg-bg-viewport"
    >
      <Canvas frameloop="demand" dpr={[1, 2]} camera={{ position: [3, 2.4, 3.6], fov: 40 }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[4, 6, 3]} intensity={1.8} />
        <mesh>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={color("accent-solid")} />
        </mesh>
        <Grid
          position={[0, -0.5, 0]}
          infiniteGrid
          cellColor={color("viewport-grid")}
          sectionColor={color("border-strong")}
          fadeDistance={24}
        />
        <CameraControls makeDefault />
        <GizmoHelper alignment="bottom-right" margin={[56, 56]}>
          <GizmoViewport
            axisColors={[color("axis-x"), color("axis-y"), color("axis-z")]}
            labelColor={color("axis-label")}
          />
        </GizmoHelper>
      </Canvas>
    </div>
  );
}
