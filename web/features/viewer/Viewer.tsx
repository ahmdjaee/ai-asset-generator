import { useGLTF } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { LoaderCircle, PanelRight, RotateCcw, TriangleAlert } from "lucide-react";
import {
  Component,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { EmptyState } from "@/components/EmptyState.tsx";
import { LiveStatus } from "@/components/LiveStatus.tsx";
import { Button } from "@/components/ui/button.tsx";
import { IconButton } from "@/components/ui/icon-button.tsx";
import { notify } from "@/components/ui/toast.tsx";
import { t } from "@/i18n/id.ts";
import { fileStem, saveBlob } from "@/lib/download.ts";
import { inertOutside } from "@/lib/inert.ts";
import { installThreeConsoleFilter } from "@/lib/three-console.ts";
import { useReducedMotion } from "@/lib/use-media-query.ts";
import { cn } from "@/lib/utils.ts";
import { COLOR_VALUES } from "@/styles/tokens.ts";
import { useTheme } from "@/theme.ts";
import { formatLength } from "../../../shared/format.ts";
import { AxisGizmo } from "./AxisGizmo.tsx";
import { DetailPanel, type DetailPanelData } from "./DetailPanel.tsx";
import { SHADOW_OPACITY } from "./floor.ts";
import type { ShadingMode } from "./materials.ts";
import type { CarriedView } from "./math.ts";
import { type ShortcutAction, shortcutAction, viewportKeyAction } from "./shortcuts.ts";
import {
  CAMERA_FOV,
  type GizmoHandle,
  type ScenePalette,
  type SceneReadyInfo,
  type ViewerController,
  ViewerScene,
  type ViewerSettings,
} from "./ViewerScene.tsx";
import { ViewerToolbar } from "./ViewerToolbar.tsx";

installThreeConsoleFilter();

type Stage = "base" | "final";

export type ViewerProps = Readonly<{
  /** URL file GLB versi yang ditampilkan. */
  src: string;
  /** Nama aset: label kanvas untuk pembaca layar dan nama file "Ambil gambar". */
  name: string;
  /**
   * Tahap aset: bentuk dasar dibuka di mode Clay dengan wireframe, aset final di mode Tekstur. Berlaku juga saat tahap
   * berganti tanpa viewer dipasang ulang (aset final datang, atau pemilik membuka versi bentuk dasar).
   */
  stage?: Stage;
  /** Isi panel Detail (statistik, versi, validasi). Tanpa ini panel tidak ditampilkan. */
  detail?: DetailPanelData;
  className?: string;
  ref?: Ref<ViewerHandle>;
}>;

/** Kendali viewer dari luar: tombol kamera di kolom pesan melampirkan gambar viewport. */
export type ViewerHandle = Readonly<{
  /** PNG kanvas pada sudut dan mode sekarang; `null` bila model belum tampil atau kanvas gagal dibaca. */
  captureView: () => Promise<Readonly<{ blob: Blob; mode: ShadingMode }> | null>;
}>;

function stageDefaults(stage: Stage): Pick<ViewerSettings, "mode" | "wireframe"> {
  return { mode: stage === "final" ? "texture" : "clay", wireframe: stage === "base" };
}

function initialSettings(stage: Stage): ViewerSettings {
  return { ...stageDefaults(stage), grid: true, lightFollowsCamera: false, autoRotate: false };
}

/** Kontrol yang menerima fokus bila kontrol yang sedang difokus dilepas dari DOM. */
type FocusTarget = "expand" | "collapse" | "canvas" | "overlay";

function reportViewerError(error: unknown): void {
  console.error("Viewer 3D:", error);
}

let webglSupport: boolean | null = null;

/** Viewer butuh WebGL2 (three r187). Dicek sekali; konteks uji langsung dilepas lagi. */
function webglAvailable(): boolean {
  if (webglSupport === null) {
    const context = document.createElement("canvas").getContext("webgl2");
    webglSupport = context !== null;
    context?.getExtension("WEBGL_lose_context")?.loseContext();
  }
  return webglSupport;
}

/** Menangkap GLB yang gagal dimuat atau diurai (error dari `useGLTF` dilempar ke pohon DOM oleh R3F). */
class LoadBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(): void {
    this.props.onError();
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/** Jarak elemen yang melayang di atas kanvas (toolbar, panel, gizmo) dari tepi viewer dan satu sama lain. */
const FLOAT_EDGE = 16;
const FLOAT_GAP = 12;
/** Ruang kanan bawah untuk gizmo (96) + keterangan grid (16) + tepi, yang tidak ditutupi panel Detail. */
const GIZMO_RESERVE = 96 + 16 + FLOAT_EDGE + FLOAT_GAP;

/**
 * Posisi atas panel Detail (atau tombol bukanya), dalam px dari atas viewer. Bila muat di samping toolbar, sejajar
 * toolbar (desain 02). Bila tidak (viewer sempit, mis. jendela 1280 atau 1024 px), turun ke bawah toolbar, supaya
 * kontrol toolbar tidak tertutup dan fokusnya tetap terlihat (WCAG 2.4.11).
 */
function sideTop(viewer: Element, toolbar: Element, side: HTMLElement): number {
  const area = viewer.getBoundingClientRect();
  const bar = toolbar.getBoundingClientRect();
  // Tanpa tata letak (tes komponen): posisi desain.
  if (area.width === 0) return FLOAT_EDGE;
  if (bar.right + FLOAT_GAP + side.offsetWidth + FLOAT_EDGE <= area.right) return FLOAT_EDGE;
  return Math.round(bar.bottom - area.top + FLOAT_GAP);
}

function Overlay({ inset, children }: { inset: number; children: ReactNode }) {
  // Di tengah area yang tidak tertutup panel, sama dengan pusat model.
  return (
    <div className="absolute inset-y-0 left-0 flex items-center justify-center p-6" style={{ right: inset }}>
      {children}
    </div>
  );
}

/**
 * Viewer 3D (FigCraft layar 02, frame Viewport #1151): kanvas R3F `frameloop="demand"`, toolbar kiri atas, panel Detail
 * kanan atas, gizmo + keterangan grid kanan bawah, petunjuk kontrol kiri bawah. Perilaku mengikuti catatan viewer di
 * FigCraft (#2710) dan prototipe `design/prototype/viewer-360.html`.
 */
export function Viewer({ src, name, stage = "base", detail, className, ref }: ViewerProps) {
  const reducedMotion = useReducedMotion();
  const { resolved } = useTheme();
  const [settings, setSettings] = useState(() => initialSettings(stage));
  const [settingsStage, setSettingsStage] = useState(stage);
  const [ready, setReady] = useState<Readonly<{ src: string; info: SceneReadyInfo }> | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [contextLost, setContextLost] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [inset, setInset] = useState(0);
  const [panelTop, setPanelTop] = useState(FLOAT_EDGE);
  const container = useRef<HTMLElement>(null);
  const toolbar = useRef<HTMLFieldSetElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const expandBox = useRef<HTMLDivElement>(null);
  const application = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const collapseButton = useRef<HTMLButtonElement>(null);
  const overlayAction = useRef<HTMLButtonElement>(null);
  const controller = useRef<ViewerController | null>(null);
  const gizmo = useRef<GizmoHandle | null>(null);
  const carriedView = useRef<CarriedView | null>(null);
  const requestedSrc = useRef(src);
  const focusNext = useRef<FocusTarget | null>(null);
  const hintId = useId();

  useLayoutEffect(() => {
    requestedSrc.current = src;
  }, [src]);

  if (settingsStage !== stage) {
    // Tahap berganti: mode dan wireframe ikut bawaan tahap baru; grid, cahaya, dan putar otomatis tetap.
    setSettingsStage(stage);
    setSettings((current) => ({ ...current, ...stageDefaults(stage) }));
  }

  const info = ready?.src === src ? ready.info : null;
  const failed = failedSrc === src;
  const showPanel = detail !== undefined && panelOpen;
  const webgl = webglAvailable();

  const palette: ScenePalette = {
    background: COLOR_VALUES["bg-viewport"][resolved],
    gridMinor: COLOR_VALUES["viewport-grid"][resolved],
    gridMajor: COLOR_VALUES["border-strong"][resolved],
    shadowOpacity: SHADOW_OPACITY[resolved],
  };
  const effective: ViewerSettings = { ...settings, autoRotate: settings.autoRotate && !reducedMotion };

  const updateSettings = useCallback((patch: Partial<ViewerSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const onReady = useCallback(
    (loaded: SceneReadyInfo) => {
      setReady({ src, info: loaded });
      // Mode yang tidak didukung model ini (mis. Tekstur pada GLB tanpa material) jatuh ke Clay.
      setSettings((current) =>
        (current.mode === "texture" && !loaded.hasMaterials) || (current.mode === "uv" && !loaded.hasUv)
          ? { ...current, mode: "clay" }
          : current,
      );
    },
    [src],
  );
  const onAutoRotateEnd = useCallback(() => updateSettings({ autoRotate: false }), [updateSettings]);

  /**
   * `leaving` akan dilepas dari DOM. Bila fokus ada di dalamnya, fokus dipindah ke `target` setelah render berikutnya,
   * supaya tidak jatuh ke `<body>`. Fokus di tempat lain (mis. kolom pesan) tidak diganggu.
   */
  const handOffFocus = useCallback((leaving: Element | null, target: FocusTarget) => {
    if (leaving?.contains(document.activeElement)) focusNext.current = target;
  }, []);
  useLayoutEffect(() => {
    const target = focusNext.current;
    if (target === null) return;
    focusNext.current = null;
    const targets = {
      expand: expandButton,
      collapse: collapseButton,
      canvas: application,
      overlay: overlayAction,
    };
    targets[target].current?.focus();
  });

  const mode = effective.mode;
  const shown = info !== null && !failed && !contextLost;
  useImperativeHandle(
    ref,
    () => ({
      captureView: async () => {
        if (!shown) return null;
        const blob = (await controller.current?.capture()) ?? null;
        return blob === null ? null : { blob, mode };
      },
    }),
    [mode, shown],
  );

  const capture = useCallback(async () => {
    const blob = (await controller.current?.capture()) ?? null;
    if (blob === null) {
      notify.error(t.viewer.captureFailed);
      return;
    }
    saveBlob(blob, `${fileStem(name)}.png`);
  }, [name]);

  const toggleFullscreen = useCallback(() => {
    if (fullscreen) {
      setFullscreen(false);
      return;
    }
    setFullscreen(true);
    // Seluruh dokumen yang dibuat layar penuh (bukan elemen viewer), supaya tooltip dan menu yang di-portal ke
    // <body> tetap tampil. Bila browser menolak atau tidak punya Fullscreen API (Safari iPhone), viewer tetap
    // memenuhi jendela lewat CSS.
    const root = document.documentElement;
    if (!document.fullscreenElement && typeof root.requestFullscreen === "function")
      void root.requestFullscreen().catch(() => undefined);
  }, [fullscreen]);

  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Selama layar penuh: sisa halaman inert (Tab tidak masuk ke kontrol yang tertutup viewer) dan Escape keluar. Layar
  // penuh dokumen ditutup saat dimatikan, termasuk saat viewer dilepas dalam keadaan layar penuh.
  useEffect(() => {
    const section = container.current;
    if (!fullscreen || !section) return;
    const restore = inertOutside(section);
    const onKeyDown = (event: KeyboardEvent) => {
      // Menu dan tooltip Radix menutup dirinya lebih dulu dan menandai event-nya.
      if (event.key === "Escape" && !event.defaultPrevented) setFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      restore();
      if (document.fullscreenElement) void document.exitFullscreen().catch(reportViewerError);
    };
  }, [fullscreen]);

  const runShortcut: Record<ShortcutAction, () => void> = {
    spin: () => {
      if (!reducedMotion) updateSettings({ autoRotate: !settings.autoRotate });
    },
    focus: () => controller.current?.focusModel(),
    wireframe: () => updateSettings({ wireframe: !settings.wireframe }),
    grid: () => updateSettings({ grid: !settings.grid }),
    light: () => updateSettings({ lightFollowsCamera: !settings.lightFollowsCamera }),
  };
  // Pintasan huruf R/F/W/G/L hanya berlaku saat fokus di dalam viewer (WCAG 2.1.4), dan tidak saat mengetik atau di
  // menu. Event dari menu toolbar (portal) ikut sampai ke sini lewat pohon React dan disaring `shortcutAction`.
  const onShortcutKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const action = shortcutAction(event.nativeEvent);
    if (action === null) return;
    runShortcut[action]();
    event.preventDefault();
  };

  // Lebar viewer yang tertutup panel Detail: pusat pandang kamera digeser ke area yang terlihat.
  useLayoutEffect(() => {
    const box = container.current;
    const panelBox = panel.current;
    if (!box || !panelBox || !showPanel) {
      setInset(0);
      return;
    }
    const measure = () =>
      setInset(
        Math.max(0, Math.round(box.getBoundingClientRect().right - panelBox.getBoundingClientRect().left)),
      );
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(panelBox);
    return () => observer.disconnect();
  }, [showPanel]);

  // Panel Detail (atau tombol bukanya) di samping toolbar bila muat, di bawahnya bila tidak.
  useLayoutEffect(() => {
    const box = container.current;
    const bar = toolbar.current;
    const side = showPanel ? panel.current : expandBox.current;
    if (!box || !bar || !side) return;
    const measure = () => setPanelTop(sideTop(box, bar, side));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(bar);
    observer.observe(side);
    return () => observer.disconnect();
  }, [showPanel]);

  const onViewportKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const control = controller.current;
    const action = viewportKeyAction(event);
    if (!control || action === null) return;
    if (action.kind === "rotate") control.rotateBy(action.azimuth, action.polar);
    else if (action.kind === "truck") control.truckBy(action.x, action.y);
    else control.dollyBy(action.factor);
    event.preventDefault();
  };

  const collapsePanel = () => {
    handOffFocus(panel.current, "expand");
    setPanelOpen(false);
  };
  const expandPanel = () => {
    handOffFocus(expandButton.current, "collapse");
    setPanelOpen(true);
  };
  // Muat ulang dan coba lagi menampilkan state memuat sampai model baru siap; fokus pindah ke kanvas.
  const retry = () => {
    handOffFocus(overlayAction.current, "canvas");
    useGLTF.clear(src);
    setReady(null);
    setFailedSrc(null);
    setAttempt((value) => value + 1);
  };
  const reload = () => {
    handOffFocus(overlayAction.current, "canvas");
    setReady(null);
    setContextLost(false);
    setAttempt((value) => value + 1);
  };

  let overlay: ReactNode = null;
  // Diumumkan lewat live region yang selalu terpasang; teks yang tampil di overlay tidak memakai role status.
  let status = "";
  if (!webgl) {
    status = t.viewer.noWebgl.title;
    overlay = (
      <EmptyState
        icon={TriangleAlert}
        title={t.viewer.noWebgl.title}
        description={t.viewer.noWebgl.description}
      />
    );
  } else if (contextLost) {
    status = t.viewer.contextLost.title;
    overlay = (
      <EmptyState
        icon={TriangleAlert}
        title={t.viewer.contextLost.title}
        description={t.viewer.contextLost.description}
        action={
          <Button ref={overlayAction} variant="secondary" size="sm" icon={RotateCcw} onClick={reload}>
            {t.viewer.contextLost.reload}
          </Button>
        }
      />
    );
  } else if (failed) {
    status = t.viewer.error.title;
    overlay = (
      <EmptyState
        icon={TriangleAlert}
        title={t.viewer.error.title}
        description={t.viewer.error.description}
        action={
          <Button ref={overlayAction} variant="secondary" size="sm" icon={RotateCcw} onClick={retry}>
            {t.viewer.error.retry}
          </Button>
        }
      />
    );
  } else if (info === null) {
    status = t.viewer.loading;
    overlay = (
      <p className="flex items-center gap-2 text-small text-text-secondary">
        <LoaderCircle aria-hidden="true" size={16} className="shrink-0 motion-safe:animate-spin" />
        {t.viewer.loading}
      </p>
    );
  }

  return (
    <section
      ref={container}
      aria-label={t.viewer.region}
      className={cn(
        "isolate overflow-hidden bg-bg-viewport",
        fullscreen ? "fixed inset-0 z-40" : "relative size-full",
        className,
      )}
      onKeyDown={onShortcutKeyDown}
    >
      {webgl && !contextLost && !failed ? (
        // role application: kanvas punya kendali keyboard sendiri (panah memutar, +/− zoom), jadi pembaca layar
        // meneruskan tombol ke sini. Diberi nama dan petunjuk keyboard; kontrol lain berada di luar elemen ini.
        <div
          ref={application}
          role="application"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: kanvas 3D dengan kendali keyboard sendiri (panah, +/−); zoom tidak punya tombol lain.
          tabIndex={0}
          aria-label={t.viewer.canvas(name)}
          aria-describedby={hintId}
          // isolate + kanvas di z −1: cincin fokus (outline ke dalam) tergambar di atas lapisan WebGL.
          className="absolute inset-0 isolate focus-visible:-outline-offset-2"
          onKeyDown={onViewportKeyDown}
          onPointerDownCapture={(event) => controller.current?.setPanModifier(event.shiftKey)}
        >
          {/* Ganti versi hanya mengganti adegan di dalam kanvas: konteks WebGL dan sudut kamera tetap. */}
          <LoadBoundary
            key={attempt}
            onError={() => {
              handOffFocus(application.current, "overlay");
              setFailedSrc(src);
            }}
          >
            <Canvas
              key={attempt}
              className="-z-1"
              frameloop="demand"
              dpr={[1, 2]}
              shadows="variance"
              // Tone mapping sama dengan renderer contact sheet, supaya yang dilihat Claude = yang dilihat pemilik.
              gl={{ antialias: true, toneMapping: THREE.NeutralToneMapping }}
              camera={{ fov: CAMERA_FOV, manual: true }}
              onCreated={({ gl }) => {
                gl.domElement.addEventListener("webglcontextlost", (event) => {
                  // R3F memanggil forceContextLoss saat kanvas ini dilepas. Konteksnya sudah hilang, jadi three tidak
                  // menemukan ekstensi WEBGL_lose_context lagi dan hanya mencetak peringatan.
                  gl.forceContextLoss = () => undefined;
                  // Kanvas lama yang dilepas (coba lagi, muat ulang) juga melepas konteksnya; itu bukan gangguan.
                  if (event.target instanceof HTMLCanvasElement && event.target.isConnected) {
                    handOffFocus(application.current, "overlay");
                    setContextLost(true);
                  }
                });
              }}
            >
              <Suspense fallback={null}>
                <ViewerScene
                  key={src}
                  src={src}
                  settings={effective}
                  palette={palette}
                  reducedMotion={reducedMotion}
                  insetRight={inset}
                  controllerRef={controller}
                  gizmoRef={gizmo}
                  viewRef={carriedView}
                  requestedSrc={requestedSrc}
                  onReady={onReady}
                  onAutoRotateEnd={onAutoRotateEnd}
                />
              </Suspense>
            </Canvas>
          </LoadBoundary>
        </div>
      ) : null}
      <p id={hintId} className="sr-only">
        {t.viewer.keyboardHint}
      </p>
      <LiveStatus text={status} />

      {overlay ? <Overlay inset={inset}>{overlay}</Overlay> : null}

      <ViewerToolbar
        ref={toolbar}
        className="absolute top-4 left-4 max-w-[calc(100%-2rem)]"
        settings={effective}
        availability={{
          texture: info?.hasMaterials ?? stage === "final",
          uv: info?.hasUv ?? true,
          reducedMotion,
        }}
        fullscreen={fullscreen}
        onSettingsChange={updateSettings}
        onPreset={(preset) => controller.current?.goPreset(preset)}
        currentPreset={() => controller.current?.currentPreset() ?? null}
        onFocus={() => controller.current?.focusModel()}
        onCapture={() => void capture().catch(reportViewerError)}
        onFullscreen={toggleFullscreen}
      />

      {detail !== undefined ? (
        showPanel ? (
          <div
            ref={panel}
            className="absolute right-4 overflow-y-auto rounded-xl"
            // Tinggi panel berhenti sebelum gizmo; panel yang lebih panjang digulir.
            style={{ top: panelTop, maxHeight: `calc(100% - ${panelTop + GIZMO_RESERVE}px)` }}
          >
            <DetailPanel data={detail} onCollapse={collapsePanel} collapseRef={collapseButton} />
          </div>
        ) : (
          <div
            ref={expandBox}
            className="absolute right-4 rounded-[10px] border border-border-default bg-bg-panel p-1"
            style={{ top: panelTop }}
          >
            <IconButton
              ref={expandButton}
              size="sm"
              icon={PanelRight}
              label={t.detailPanel.expand}
              tooltipSide="bottom"
              onClick={expandPanel}
            />
          </div>
        )
      ) : null}

      {webgl && !contextLost && !failed ? (
        // Gizmo terpasang sejak awal (tersembunyi sampai frame pertama), supaya frame pertama bisa menempatkannya.
        <div className="absolute right-4 bottom-4 flex w-24 flex-col items-center">
          <AxisGizmo ref={gizmo} onSelect={(preset) => controller.current?.goPreset(preset)} />
          <p
            className={cn(
              "h-4 text-caption text-text-tertiary",
              (!effective.grid || info === null) && "invisible",
            )}
          >
            {info ? t.viewer.gridCaption(formatLength(info.gridCell)) : null}
          </p>
        </div>
      ) : null}
      {/* Berhenti sebelum kolom gizmo (96 + tepi + jarak); di viewer sempit petunjuk terlipat ke atas. */}
      <p className="absolute bottom-4 left-4 max-w-[calc(100%-9rem)] text-caption text-text-tertiary">
        {t.viewer.hint}
      </p>
    </section>
  );
}
