import { CameraControls, CameraControlsImpl, useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { lightPosition, SCENE_LIGHTING } from "../../../shared/scene.ts";
import { applyViewOffset } from "./camera.ts";
import { createGridMaterial, gridFade, setRawColor } from "./floor.ts";
import { hold, holdCached } from "./lifetime.ts";
import { disposeTree, environmentIntensity, ModeMaterials, type ShadingMode } from "./materials.ts";
import {
  AUTO_ROTATE_SPEED,
  type CarriedView,
  carryView,
  distanceLimits,
  fitDistance,
  floorVisibility,
  gridCellSize,
  KEYBOARD_TRUCK_FACTOR,
  nearestPreset,
  PRESETS,
  type PresetId,
  placeView,
  shortestAzimuth,
  underLightIntensity,
} from "./math.ts";
import { createWireframes, type ModelInfo, prepareModel } from "./model.ts";
import { installProbe } from "./test-hook.ts";

const { ACTION } = CameraControlsImpl;

/** Sudut pandang vertikal kamera viewer (prototipe dan desain). */
export const CAMERA_FOV = 30;

export type ViewerSettings = Readonly<{
  mode: ShadingMode;
  wireframe: boolean;
  grid: boolean;
  lightFollowsCamera: boolean;
  autoRotate: boolean;
}>;

/** Warna adegan dari token tema aktif; opasitas bayangan per tema (prototipe: gelap 0,42, terang 0,22). */
export type ScenePalette = Readonly<{
  background: string;
  gridMinor: string;
  gridMajor: string;
  shadowOpacity: number;
}>;

export type SceneReadyInfo = ModelInfo & Readonly<{ gridCell: number }>;

/** Aksi kamera untuk toolbar, menu Sudut, gizmo, dan keyboard. */
export interface ViewerController {
  goPreset(id: PresetId): void;
  focusModel(): void;
  rotateBy(azimuth: number, polar: number): void;
  /** Geser pusat pandang searah layar; `x`/`y` −1..1 dikali langkah keyboard (sebagian jarak kamera). */
  truckBy(x: number, y: number): void;
  dollyBy(factor: number): void;
  /** Shift ditekan saat mulai menyeret: geser, bukan putar. */
  setPanModifier(pan: boolean): void;
  currentPreset(): PresetId | null;
  /** PNG isi kanvas (tanpa toolbar), model di tengah gambar. */
  capture(): Promise<Blob | null>;
}

export interface GizmoHandle {
  update(view: ArrayLike<number>): void;
}

type SceneProps = Readonly<{
  src: string;
  settings: ViewerSettings;
  palette: ScenePalette;
  reducedMotion: boolean;
  /** Lebar (px) sisi kanan viewer yang tertutup panel; pusat pandang digeser ke area yang terlihat. */
  insetRight: number;
  controllerRef: RefObject<ViewerController | null>;
  gizmoRef: RefObject<GizmoHandle | null>;
  /**
   * Sudut pandang model sebelumnya (versi lain di viewer yang sama). Dipakai saat model ini ditempatkan, dan diisi
   * ulang saat model ini dilepas, supaya berganti versi tidak mengembalikan kamera ke sudut 3/4.
   */
  viewRef: RefObject<CarriedView | null>;
  /**
   * File yang sedang diminta viewer. Saat ganti versi, adegan lama tetap tampil sampai GLB baru dimuat; test hook-nya
   * tidak boleh melapor "siap" untuk model yang sudah tidak diminta.
   */
  requestedSrc: RefObject<string>;
  onReady: (info: SceneReadyInfo) => void;
  onAutoRotateEnd: () => void;
}>;

/** Arah lampu utama dari sudut pandang kamera saat mode "cahaya ikut kamera": sama dengan arah dunia dari depan. */
const HEADLIGHT_DIRECTION = new THREE.Vector3(...SCENE_LIGHTING.key.direction);
const UNDER_LIGHT_DIRECTION = [0.2, -1, 0.4] as const;
const MAX_FRAME_DELTA = 0.1;

function reportCameraError(error: unknown): void {
  console.error("Transisi kamera viewer gagal", error);
}

/** Cahaya lingkungan RoomEnvironment (lokal, tanpa HDRI dari CDN) sebagai PMREM. */
function createEnvironment(gl: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const room = new RoomEnvironment();
  const generator = new THREE.PMREMGenerator(gl);
  const target = generator.fromScene(room, SCENE_LIGHTING.environment.pmremSigma);
  generator.dispose();
  room.dispose();
  return target;
}

export function ViewerScene({
  src,
  settings,
  palette,
  reducedMotion,
  insetRight,
  controllerRef,
  gizmoRef,
  viewRef,
  requestedSrc,
  onReady,
  onAutoRotateEnd,
}: SceneProps) {
  const gltf = useGLTF(src, false, true);
  const model = useMemo(() => prepareModel(gltf), [gltf]);
  const materials = useMemo(() => new ModeMaterials(), []);
  const gridMaterial = useMemo(() => createGridMaterial(), []);
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);

  const controls = useRef<CameraControlsImpl>(null);
  const keyLight = useRef<THREE.DirectionalLight>(null);
  const fillLight = useRef<THREE.DirectionalLight>(null);
  const underLight = useRef<THREE.DirectionalLight>(null);
  const gridMesh = useRef<THREE.Mesh>(null);
  const catcher = useRef<THREE.Mesh>(null);
  const catcherMaterial = useRef<THREE.ShadowMaterial>(null);

  const live = useRef({ settings, palette, reducedMotion, fit: 1, onAutoRotateEnd });
  const motion = useRef({ frames: 0, placedAtFrame: -1, requestedAtFrame: -1, awake: false, floor: 1 });

  const perspective = camera instanceof THREE.PerspectiveCamera ? camera : null;
  const freeWidth = Math.max(size.width - Math.min(insetRight, size.width / 2), 1);
  const fit = fitDistance(model.radius, CAMERA_FOV, freeWidth / Math.max(size.height, 1));
  const fade = gridFade(model.radius);
  const gridCell = gridCellSize(Math.max(model.size.x, model.size.y, model.size.z));

  useLayoutEffect(() => {
    live.current = { settings, palette, reducedMotion, fit, onAutoRotateEnd };
  });

  // Lingkungan cahaya dibuat dan dibuang di effect yang sama (StrictMode mengulang pasangan ini dengan aman).
  useEffect(() => {
    const environment = createEnvironment(gl);
    scene.environment = environment.texture;
    invalidate();
    return () => {
      if (scene.environment === environment.texture) scene.environment = null;
      environment.dispose();
    };
  }, [gl, scene, invalidate]);

  // Bayangan hanya digambar ulang bila model atau lampu berubah, bukan setiap kali kamera bergerak.
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
  }, [gl]);

  // Objek dari render (GLTF di cache useGLTF, material) dibuang setelah pemakai terakhir lepas: saat viewer dilepas
  // atau aset berganti. Cache URL itu ikut dikosongkan supaya GLB tidak tertahan di memori (lihat lifetime.ts).
  useEffect(() => holdCached(src, gltf, () => disposeTree(gltf.scene), useGLTF.clear), [src, gltf]);
  useEffect(() => hold(materials, () => materials.dispose()), [materials]);
  useEffect(() => hold(gridMaterial, () => gridMaterial.dispose()), [gridMaterial]);

  // Kamera, batas zoom, lampu, dan bayangan mengikuti ukuran model.
  useLayoutEffect(() => {
    const { center, radius } = model;
    camera.near = radius / 100;
    camera.far = radius * 200;
    camera.updateProjectionMatrix();
    const centerTuple = center.toArray();
    for (const [light, direction] of [
      [keyLight.current, SCENE_LIGHTING.key.direction],
      [fillLight.current, SCENE_LIGHTING.fill.direction],
      [underLight.current, UNDER_LIGHT_DIRECTION],
    ] as const) {
      if (!light) continue;
      light.position.set(...lightPosition(centerTuple, radius, direction));
      light.target.position.copy(center);
      light.target.updateMatrixWorld();
    }
    const key = keyLight.current;
    if (key) {
      const shadowCamera = key.shadow.camera;
      const extent = radius * 2;
      const distance = key.position.distanceTo(center);
      shadowCamera.left = shadowCamera.bottom = -extent;
      shadowCamera.right = shadowCamera.top = extent;
      shadowCamera.near = Math.max(distance - radius * 3, radius / 100);
      shadowCamera.far = distance + radius * 3;
      shadowCamera.updateProjectionMatrix();
    }
    gl.shadowMap.needsUpdate = true;
    invalidate();
  }, [model, camera, gl, invalidate]);

  // Penempatan awal: sudut pandang versi sebelumnya bila ada, selain itu sudut 3/4 dengan model dibingkai.
  useLayoutEffect(() => {
    const control = controls.current;
    if (!control) return;
    const frame = { center: model.center.toArray(), radius: model.radius };
    const limits = distanceLimits(model.radius, live.current.fit);
    control.minDistance = limits.min;
    control.maxDistance = limits.max;
    const view = placeView(viewRef.current, frame, live.current.fit, limits);
    void Promise.all([
      control.moveTo(...view.target, false),
      control.rotateTo(view.azimuth, view.polar, false),
      control.dollyTo(view.distance, false),
    ]).catch(reportCameraError);
    motion.current.placedAtFrame = motion.current.frames;
    invalidate();
    onReady({ ...model.info, gridCell });
    return () => {
      // Nilai akhir transisi (bukan posisi animasi saat ini): pemilik bisa berganti versi di tengah animasi kamera.
      const angles = control.getSpherical(new THREE.Spherical(), true);
      const target = control.getTarget(new THREE.Vector3(), true);
      viewRef.current = carryView(
        { azimuth: angles.theta, polar: angles.phi, distance: angles.radius, target: target.toArray() },
        frame,
        live.current.fit,
      );
    };
  }, [model, gridCell, viewRef, invalidate, onReady]);

  // Batas zoom dan pusat pandang ikut ukuran viewer dan panel.
  useLayoutEffect(() => {
    const control = controls.current;
    if (control) {
      const limits = distanceLimits(model.radius, fit);
      control.minDistance = limits.min;
      control.maxDistance = limits.max;
    }
    if (perspective) applyViewOffset(perspective, size.width, size.height, insetRight);
    invalidate();
  }, [model.radius, fit, perspective, size.width, size.height, insetRight, invalidate]);

  // Mode shading: material pengganti per mesh, material asli disimpan untuk mode Tekstur.
  useLayoutEffect(() => {
    for (const mesh of model.meshes) {
      mesh.material = materials.forMode(settings.mode, model.originals.get(mesh) ?? mesh.material);
    }
    scene.environmentIntensity = environmentIntensity(settings.mode);
    invalidate();
  }, [model, materials, scene, settings.mode, invalidate]);

  // Garis wireframe dibuat saat W menyala dan dilepas saat mati (anak mesh, geometri sendiri).
  useLayoutEffect(() => {
    if (!settings.wireframe) return;
    const lines = createWireframes(model.meshes, materials.wire);
    invalidate();
    return () => {
      for (const line of lines) {
        line.removeFromParent();
        line.geometry.dispose();
      }
      invalidate();
    };
  }, [model, materials, settings.wireframe, invalidate]);

  // Warna grid dari token; pudar sebanding ukuran model.
  useLayoutEffect(() => {
    const { uniforms } = gridMaterial;
    setRawColor(uniforms.uMinor.value, palette.gridMinor);
    setRawColor(uniforms.uMajor.value, palette.gridMajor);
    uniforms.uCell.value = gridCell;
    uniforms.uNear.value = fade.near;
    uniforms.uFar.value = fade.far;
    uniforms.uCenter.value.set(model.center.x, model.center.z);
    invalidate();
  }, [gridMaterial, palette.gridMinor, palette.gridMajor, gridCell, fade.near, fade.far, model, invalidate]);

  // Tombol Grid dan tema langsung berlaku tanpa menunggu kamera bergerak (useFrame menjaga nilai yang sama).
  useLayoutEffect(() => {
    if (gridMesh.current) gridMesh.current.visible = settings.grid && motion.current.floor > 0;
    invalidate();
  }, [settings.grid, invalidate]);
  useLayoutEffect(() => {
    if (catcherMaterial.current)
      catcherMaterial.current.opacity = palette.shadowOpacity * motion.current.floor;
    invalidate();
  }, [palette.shadowOpacity, invalidate]);

  // Putar otomatis: satu frame memulai putaran, lalu useFrame meminta frame berikutnya selama aktif. Saat berhenti,
  // camera-controls sendiri menggambar satu frame terakhir lalu "tidur".
  useEffect(() => {
    if (settings.autoRotate) invalidate();
  }, [settings.autoRotate, invalidate]);

  useEffect(() => {
    const key = keyLight.current;
    if (!key || settings.lightFollowsCamera) return;
    key.position.set(...lightPosition(model.center.toArray(), model.radius, SCENE_LIGHTING.key.direction));
    key.target.position.copy(model.center);
    key.target.updateMatrixWorld();
    gl.shadowMap.needsUpdate = true;
    invalidate();
  }, [settings.lightFollowsCamera, model, gl, invalidate]);

  // Seret menghentikan putar otomatis; status bangun/tidur kamera untuk test hook.
  useEffect(() => {
    const control = controls.current;
    if (!control) return;
    const onControlStart = () => {
      if (live.current.settings.autoRotate) live.current.onAutoRotateEnd();
    };
    const onWake = () => {
      motion.current.awake = true;
    };
    const onSleep = () => {
      motion.current.awake = false;
    };
    control.addEventListener("controlstart", onControlStart);
    control.addEventListener("wake", onWake);
    control.addEventListener("sleep", onSleep);
    return () => {
      control.removeEventListener("controlstart", onControlStart);
      control.removeEventListener("wake", onWake);
      control.removeEventListener("sleep", onSleep);
    };
  }, []);

  // Klik dua kali: fokus ke titik di permukaan model.
  useEffect(() => {
    const element = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onDoubleClick = (event: MouseEvent) => {
      const control = controls.current;
      if (!control) return;
      const rect = element.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects([...model.meshes], false)[0];
      if (!hit) return;
      if (live.current.settings.autoRotate) live.current.onAutoRotateEnd();
      const animate = !live.current.reducedMotion;
      motion.current.requestedAtFrame = motion.current.frames;
      void Promise.all([
        control.moveTo(hit.point.x, hit.point.y, hit.point.z, animate),
        control.dollyTo(Math.max(control.minDistance, control.distance * 0.7), animate),
      ]).catch(reportCameraError);
      invalidate();
    };
    element.addEventListener("dblclick", onDoubleClick);
    return () => element.removeEventListener("dblclick", onDoubleClick);
  }, [gl, camera, model, invalidate]);

  useLayoutEffect(() => {
    const run = (...steps: Promise<unknown>[]) => {
      motion.current.requestedAtFrame = motion.current.frames;
      void Promise.all(steps).catch(reportCameraError);
      invalidate();
    };
    const stopSpin = () => {
      if (live.current.settings.autoRotate) live.current.onAutoRotateEnd();
    };
    const endAngles = (control: CameraControlsImpl) => control.getSpherical(new THREE.Spherical(), true);
    const controller: ViewerController = {
      goPreset(id) {
        const control = controls.current;
        if (!control) return;
        stopSpin();
        const preset = PRESETS[id];
        const animate = !live.current.reducedMotion;
        const { center } = model;
        run(
          control.moveTo(center.x, center.y, center.z, animate),
          control.rotateTo(shortestAzimuth(endAngles(control).theta, preset.azimuth), preset.polar, animate),
          control.dollyTo(live.current.fit, animate),
        );
      },
      focusModel() {
        const control = controls.current;
        if (!control) return;
        const animate = !live.current.reducedMotion;
        const { center } = model;
        run(
          control.moveTo(center.x, center.y, center.z, animate),
          control.dollyTo(live.current.fit, animate),
        );
      },
      rotateBy(azimuth, polar) {
        const control = controls.current;
        if (!control) return;
        stopSpin();
        run(control.rotate(azimuth, polar, !live.current.reducedMotion));
      },
      truckBy(x, y) {
        const control = controls.current;
        if (!control) return;
        stopSpin();
        const step = endAngles(control).radius * KEYBOARD_TRUCK_FACTOR;
        run(control.truck(x * step, y * step, !live.current.reducedMotion));
      },
      dollyBy(factor) {
        const control = controls.current;
        if (!control) return;
        run(control.dollyTo(endAngles(control).radius * (1 - factor), !live.current.reducedMotion));
      },
      setPanModifier(pan) {
        const control = controls.current;
        if (control) control.mouseButtons.left = pan ? ACTION.TRUCK : ACTION.ROTATE;
      },
      currentPreset() {
        const control = controls.current;
        if (!control) return null;
        const angles = endAngles(control);
        return nearestPreset({ azimuth: angles.theta, polar: angles.phi });
      },
      capture() {
        return new Promise((resolve) => {
          // Tanpa geser pusat pandang: model di tengah gambar walaupun panel menutupi sisi kanan viewer.
          if (perspective) applyViewOffset(perspective, size.width, size.height, 0);
          gl.render(scene, camera);
          gl.domElement.toBlob(resolve, "image/png");
          if (perspective) applyViewOffset(perspective, size.width, size.height, insetRight);
          invalidate();
        });
      },
    };
    controllerRef.current = controller;
    return () => {
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [controllerRef, model, perspective, size.width, size.height, insetRight, gl, scene, camera, invalidate]);

  // Test hook (mode test saja).
  useEffect(
    () =>
      installProbe(() => {
        const control = controls.current;
        const target = control?.getTarget(new THREE.Vector3()) ?? new THREE.Vector3();
        const { settings: current, fit: fitNow } = live.current;
        const state = motion.current;
        const key = keyLight.current?.position ?? new THREE.Vector3();
        const angles = { azimuth: control?.azimuthAngle ?? 0, polar: control?.polarAngle ?? 0 };
        // Posisi pusat model di kanvas (px CSS): membuktikan geser pusat pandang ke samping panel.
        const projected = model.center.clone().project(camera);
        const canvas = gl.domElement.getBoundingClientRect();
        return {
          ready:
            requestedSrc.current === src && state.placedAtFrame >= 0 && state.frames > state.placedAtFrame,
          frames: state.frames,
          moving: current.autoRotate || state.awake || state.frames <= state.requestedAtFrame,
          ...angles,
          distance: control?.distance ?? 0,
          fitDistance: fitNow,
          target: target.toArray(),
          center: model.center.toArray(),
          radius: model.radius,
          preset: nearestPreset(angles),
          mode: current.mode,
          wireframe: current.wireframe,
          grid: current.grid,
          gridVisible: gridMesh.current?.visible ?? false,
          lightFollowsCamera: current.lightFollowsCamera,
          autoRotate: current.autoRotate,
          floorVisible: catcher.current?.visible ?? false,
          floorOpacity: state.floor,
          keyLight: key.toArray(),
          triangles: model.info.triangles,
          centerOnScreen: [((projected.x + 1) / 2) * canvas.width, ((1 - projected.y) / 2) * canvas.height],
          memory: {
            geometries: gl.info.memory.geometries,
            textures: gl.info.memory.textures,
            programs: gl.info.programs?.length ?? 0,
          },
        };
      }),
    [model, camera, gl, requestedSrc, src],
  );

  // Putar otomatis sebelum camera-controls memperbarui kamera (prioritas lebih kecil = lebih dulu).
  useFrame((_, delta) => {
    const control = controls.current;
    if (!control || !live.current.settings.autoRotate) return;
    // Azimuth berkurang, searah putar otomatis prototipe (OrbitControls.autoRotate: theta −= sudut).
    control.azimuthAngle -= AUTO_ROTATE_SPEED * Math.min(delta, MAX_FRAME_DELTA);
    invalidate();
  }, -2);

  // Setelah kamera diperbarui: cahaya ikut kamera, lantai, gizmo, hitungan frame. Tanpa setState.
  useFrame(() => {
    const control = controls.current;
    const state = motion.current;
    state.frames += 1;
    if (!control) return;
    camera.updateMatrixWorld();
    const key = keyLight.current;
    if (key && live.current.settings.lightFollowsCamera) {
      const target = control.getTarget(key.target.position);
      key.position
        .copy(HEADLIGHT_DIRECTION)
        .applyQuaternion(camera.quaternion)
        .multiplyScalar(model.radius * SCENE_LIGHTING.distanceFactor)
        .add(target);
      key.target.updateMatrixWorld();
      gl.shadowMap.needsUpdate = true;
    }
    const floor = floorVisibility(camera.position.y - model.floorY, model.radius);
    state.floor = floor;
    gridMaterial.uniforms.uOpacity.value = floor;
    if (gridMesh.current) gridMesh.current.visible = live.current.settings.grid && floor > 0;
    if (catcher.current) catcher.current.visible = floor > 0;
    if (catcherMaterial.current) catcherMaterial.current.opacity = live.current.palette.shadowOpacity * floor;
    if (underLight.current) underLight.current.intensity = underLightIntensity(floor);
    gizmoRef.current?.update(camera.matrixWorldInverse.elements);
  });

  const { hemisphere, key, fill } = SCENE_LIGHTING;
  const floorY = model.floorY;
  return (
    <>
      <color attach="background" args={[palette.background]} />
      <directionalLight
        ref={keyLight}
        color={key.color}
        intensity={key.intensity}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.01}
        shadow-radius={10}
        shadow-blurSamples={16}
      />
      <directionalLight ref={fillLight} color={fill.color} intensity={fill.intensity} />
      <directionalLight ref={underLight} color={key.color} intensity={0} />
      <hemisphereLight args={[hemisphere.sky, hemisphere.ground, hemisphere.intensity]} />
      <primitive object={model.root} />
      <mesh
        ref={gridMesh}
        material={gridMaterial}
        renderOrder={-1}
        rotation-x={-Math.PI / 2}
        position={[model.center.x, floorY - model.radius * 1e-3, model.center.z]}
      >
        <planeGeometry args={[fade.extent, fade.extent]} />
      </mesh>
      <mesh
        ref={catcher}
        receiveShadow
        rotation-x={-Math.PI / 2}
        position={[model.center.x, floorY, model.center.z]}
      >
        <planeGeometry args={[fade.extent, fade.extent]} />
        <shadowMaterial ref={catcherMaterial} transparent />
      </mesh>
      <CameraControls ref={controls} makeDefault />
    </>
  );
}
