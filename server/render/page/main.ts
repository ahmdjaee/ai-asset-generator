/**
 * Halaman render (dijalankan di Chromium headless + SwiftShader). Di-bundle oleh `Bun.build` saat renderer start.
 * Diekspos ke Playwright lewat `window.aagRender` (contact sheet), `window.aagTurntable` (thumbnail Gudang),
 * `window.aagRendererInfo`, dan `window.aagGpuMemory`.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { lightPosition, SCENE_LIGHTING, SCENE_MATERIALS, THUMBNAIL_VIEW } from "../../../shared/scene.ts";
import type {
  GpuMemory,
  PageRenderRequest,
  PageRenderResult,
  PageTile,
  PageTurntableRequest,
  PageTurntableResult,
  RenderView,
} from "../protocol.ts";

declare global {
  interface Window {
    aagRender: (request: PageRenderRequest) => Promise<PageRenderResult>;
    aagTurntable: (request: PageTurntableRequest) => Promise<PageTurntableResult>;
    aagRendererInfo: () => string;
    aagGpuMemory: () => GpuMemory;
    aagReady: boolean;
  }
}

/**
 * Warna netral dari palet desain (tema gelap); contact sheet tidak mengikuti tema UI. Lampu dan material Clay/wireframe
 * dari `shared/scene.ts`, sama dengan viewer.
 */
const COLORS = {
  background: "#18181b",
  gridMinor: "#25252b",
  gridMajor: "#33333b",
  label: "#e4e4e7",
  labelBackground: "rgba(24, 24, 27, 0.75)",
};
const FOV = 24;
const MARGIN = 1.15;

// `alpha`: turntable berlatar transparan. Contact sheet selalu berlatar warna, jadi hasilnya tetap buram.
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
const environment = new THREE.PMREMGenerator(renderer).fromScene(
  new RoomEnvironment(),
  SCENE_LIGHTING.environment.pmremSigma,
).texture;

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const labelCanvas = document.createElement("canvas");

const VIEW_DIRECTIONS: Readonly<Record<RenderView, readonly [number, number, number]>> = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 1, 0],
  three_quarter: [1, 0.75, 1.25],
};

function gridCell(maxSize: number): number {
  return 10 ** Math.floor(Math.log10(Math.max(maxSize, 1e-3) * 2)) / 10;
}

/** Grid lantai sebagai tekstur kanvas (GridHelper hanya menggambar satu arah di SwiftShader). */
function gridPlane(cell: number, extent: number): THREE.Mesh {
  const cells = Math.max(10, Math.ceil(extent / cell / 10) * 10);
  const size = 2048;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Canvas 2D tidak tersedia");
  context.fillStyle = COLORS.background;
  context.fillRect(0, 0, size, size);
  for (let index = 0; index <= cells; index++) {
    const major = index % 10 === 0;
    context.strokeStyle = major ? COLORS.gridMajor : COLORS.gridMinor;
    context.lineWidth = major ? 4 : 2;
    const position = Math.round((index * size) / cells);
    context.beginPath();
    context.moveTo(position, 0);
    context.lineTo(position, size);
    context.moveTo(0, position);
    context.lineTo(size, position);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const width = cells * cell;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = -0.0005 * width;
  return plane;
}

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) found.push(object);
  });
  return found;
}

function triangleCount(root: THREE.Object3D): number {
  return meshes(root).reduce((total, mesh) => {
    const geometry = mesh.geometry;
    const count = geometry.index ? geometry.index.count : (geometry.getAttribute("position")?.count ?? 0);
    return total + count / 3;
  }, 0);
}

type Materials = Map<THREE.Mesh, THREE.Material | THREE.Material[]>;

/** Material mode dipasang di mesh model; garis wireframe (geometri dan material sendiri) dikembalikan untuk dibuang. */
function applyMode(
  root: THREE.Object3D,
  mode: PageRenderRequest["mode"],
  originals: Materials,
  clay: THREE.Material,
): THREE.Object3D[] {
  const extras: THREE.Object3D[] = [];
  for (const mesh of meshes(root)) {
    mesh.material = mode === "texture" ? (originals.get(mesh) ?? clay) : clay;
    if (mode === "wireframe") {
      const lines = new THREE.LineSegments(
        new THREE.WireframeGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({ ...SCENE_MATERIALS.wire, transparent: true }),
      );
      mesh.add(lines);
      extras.push(lines);
    }
  }
  return extras;
}

function placeCamera(camera: THREE.PerspectiveCamera, view: RenderView, sphere: THREE.Sphere): void {
  const direction = new THREE.Vector3(...VIEW_DIRECTIONS[view]).normalize();
  const distance = (sphere.radius * MARGIN) / Math.sin(THREE.MathUtils.degToRad(FOV) / 2);
  camera.position.copy(sphere.center).addScaledVector(direction, distance);
  camera.up.set(0, 1, 0);
  if (view === "top") camera.up.set(0, 0, -1);
  camera.near = distance / 100;
  camera.far = distance * 10;
  camera.lookAt(sphere.center);
  camera.updateProjectionMatrix();
}

/** Siluet: objek putih tanpa grid di latar hitam → cakupan dan titik berat. */
function silhouette(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  grid: THREE.Object3D,
  tilePx: number,
): Pick<PageTile, "coverage" | "centroid"> {
  const previousBackground = scene.background;
  scene.background = new THREE.Color("#000000");
  scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  grid.visible = false;
  const target = new THREE.WebGLRenderTarget(tilePx, tilePx);
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const pixels = new Uint8Array(tilePx * tilePx * 4);
  renderer.readRenderTargetPixels(target, 0, 0, tilePx, tilePx, pixels);
  renderer.setRenderTarget(null);
  target.dispose();
  scene.overrideMaterial?.dispose();
  scene.overrideMaterial = null;
  scene.background = previousBackground;
  grid.visible = true;

  let covered = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < tilePx; y++) {
    for (let x = 0; x < tilePx; x++) {
      if ((pixels[(y * tilePx + x) * 4] ?? 0) > 127) {
        covered += 1;
        sumX += x;
        // readPixels mulai dari bawah; dibalik supaya 0 = atas.
        sumY += tilePx - 1 - y;
      }
    }
  }
  const total = tilePx * tilePx;
  return {
    coverage: covered / total,
    centroid: covered === 0 ? null : [sumX / covered / tilePx, sumY / covered / tilePx],
  };
}

function labelled(label: string, tilePx: number): string {
  labelCanvas.width = labelCanvas.height = tilePx;
  const context = labelCanvas.getContext("2d");
  if (context === null) throw new Error("Canvas 2D tidak tersedia");
  context.drawImage(renderer.domElement, 0, 0);
  context.font = "600 14px sans-serif";
  const width = context.measureText(label).width + 16;
  context.fillStyle = COLORS.labelBackground;
  context.fillRect(8, 8, width, 24);
  context.fillStyle = COLORS.label;
  context.textBaseline = "middle";
  context.fillText(label, 16, 20);
  return labelCanvas.toDataURL("image/png");
}

function dispose(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
        material.dispose();
      }
    }
  });
}

window.aagRender = async (request) => {
  const gltf = await loader.loadAsync(request.modelUrl);
  const model = gltf.scene;
  const originals: Materials = new Map(meshes(model).map((mesh) => [mesh, mesh.material]));
  const box = new THREE.Box3().setFromObject(model);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const size = box.getSize(new THREE.Vector3());
  const cell = gridCell(Math.max(size.x, size.y, size.z));
  const grid = gridPlane(cell, Math.max(size.x, size.z) * 4);
  grid.position.y += box.min.y;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.background);
  scene.environment = environment;
  const { environment: ambient, key: keySpec, fill: fillSpec, hemisphere } = SCENE_LIGHTING;
  scene.environmentIntensity = request.mode === "texture" ? ambient.texture : ambient.plain;
  const center = sphere.center.toArray();
  const key = new THREE.DirectionalLight(keySpec.color, keySpec.intensity);
  key.position.set(...lightPosition(center, sphere.radius, keySpec.direction));
  key.target.position.copy(sphere.center);
  const fill = new THREE.DirectionalLight(fillSpec.color, fillSpec.intensity);
  fill.position.set(...lightPosition(center, sphere.radius, fillSpec.direction));
  fill.target.position.copy(sphere.center);
  scene.add(
    key,
    key.target,
    fill,
    fill.target,
    new THREE.HemisphereLight(hemisphere.sky, hemisphere.ground, hemisphere.intensity),
    grid,
    model,
  );
  const clay = new THREE.MeshStandardMaterial({ ...SCENE_MATERIALS.clay });
  const extras = applyMode(model, request.mode, originals, clay);

  renderer.setSize(request.tilePx, request.tilePx, false);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 100);
  const tiles: PageTile[] = [];
  for (const view of request.views) {
    placeCamera(camera, view, sphere);
    const metrics = silhouette(scene, camera, grid, request.tilePx);
    renderer.render(scene, camera);
    tiles.push({ view, png: labelled(request.labels[view], request.tilePx), ...metrics });
  }

  const triangles = Math.round(triangleCount(model));
  // Halaman dipakai ulang antar-render: semua yang dibuat untuk render ini dibuang dari GPU.
  for (const extra of extras) {
    extra.removeFromParent();
    dispose(extra);
  }
  for (const original of originals.keys()) original.material = originals.get(original) ?? original.material;
  clay.dispose();
  dispose(model);
  dispose(grid);
  return { tiles, gridCellM: cell, triangles };
};

/** Lampu utama yang memberi bayangan lembut (VSM) di lantai, dengan kamera bayangan seukuran objek. */
function shadowKeyLight(sphere: THREE.Sphere): THREE.DirectionalLight {
  const spec = SCENE_LIGHTING.key;
  const radius = sphere.radius;
  const key = new THREE.DirectionalLight(spec.color, spec.intensity);
  key.position.set(...lightPosition(sphere.center.toArray(), radius, spec.direction));
  key.target.position.copy(sphere.center);
  key.castShadow = true;
  key.shadow.mapSize.set(THUMBNAIL_VIEW.shadowMapPx, THUMBNAIL_VIEW.shadowMapPx);
  key.shadow.radius = THUMBNAIL_VIEW.shadowRadius;
  key.shadow.blurSamples = THUMBNAIL_VIEW.shadowBlurSamples;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02 * radius;
  const camera = key.shadow.camera;
  camera.left = camera.bottom = -2 * radius;
  camera.right = camera.top = 2 * radius;
  const distance = key.position.distanceTo(sphere.center);
  camera.near = Math.max(distance - 3 * radius, 0.01 * radius);
  camera.far = distance + 3 * radius;
  camera.updateProjectionMatrix();
  return key;
}

window.aagTurntable = async (request) => {
  const gltf = await loader.loadAsync(request.modelUrl);
  const model = gltf.scene;
  const originals: Materials = new Map(meshes(model).map((mesh) => [mesh, mesh.material]));
  const box = new THREE.Box3().setFromObject(model);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  sphere.radius = Math.max(sphere.radius, 1e-3);

  // Model diputar di sumbu tegak yang melewati pusat bola batas: bola tidak berubah, jadi bingkai tetap.
  const pivot = new THREE.Group();
  pivot.position.set(sphere.center.x, 0, sphere.center.z);
  model.position.x -= sphere.center.x;
  model.position.z -= sphere.center.z;
  pivot.add(model);

  const scene = new THREE.Scene();
  scene.background = null;
  scene.environment = environment;
  const { environment: ambient, fill: fillSpec, hemisphere } = SCENE_LIGHTING;
  scene.environmentIntensity = request.mode === "texture" ? ambient.texture : ambient.plain;
  const key = shadowKeyLight(sphere);
  const fill = new THREE.DirectionalLight(fillSpec.color, fillSpec.intensity);
  fill.position.set(...lightPosition(sphere.center.toArray(), sphere.radius, fillSpec.direction));
  fill.target.position.copy(sphere.center);
  const floorSize = 12 * sphere.radius;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(floorSize, floorSize),
    new THREE.ShadowMaterial({ opacity: THUMBNAIL_VIEW.shadowOpacity }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(sphere.center.x, box.min.y, sphere.center.z);
  floor.receiveShadow = true;
  scene.add(
    key,
    key.target,
    fill,
    fill.target,
    new THREE.HemisphereLight(hemisphere.sky, hemisphere.ground, hemisphere.intensity),
    floor,
    pivot,
  );
  const clay = new THREE.MeshStandardMaterial({ ...SCENE_MATERIALS.clay });
  for (const mesh of meshes(model)) {
    // Hanya lantai yang menerima bayangan: objek bebas dari jerawat bayangan pada geometri apa pun.
    mesh.castShadow = true;
    mesh.material = request.mode === "texture" ? (originals.get(mesh) ?? clay) : clay;
  }

  const view = THUMBNAIL_VIEW;
  const camera = new THREE.PerspectiveCamera(view.fovDeg, request.width / request.height);
  const distance = (sphere.radius * view.margin) / Math.sin(THREE.MathUtils.degToRad(view.fovDeg) / 2);
  camera.position
    .copy(sphere.center)
    .addScaledVector(new THREE.Vector3(...view.direction).normalize(), distance);
  camera.near = distance / 100;
  camera.far = distance * 10;
  camera.lookAt(sphere.center);
  camera.updateProjectionMatrix();

  renderer.setSize(request.width, request.height, false);
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  const frames: string[] = [];
  try {
    for (let index = 0; index < request.frames; index++) {
      pivot.rotation.y = (index / request.frames) * Math.PI * 2;
      renderer.render(scene, camera);
      frames.push(renderer.domElement.toDataURL("image/png"));
    }
  } finally {
    // Halaman dipakai ulang: peta bayangan, material, dan model dibuang dari GPU; contact sheet tanpa bayangan.
    renderer.shadowMap.enabled = false;
    key.shadow.dispose();
    for (const original of originals.keys()) original.material = originals.get(original) ?? original.material;
    clay.dispose();
    dispose(model);
    dispose(floor);
  }
  return { frames };
};

window.aagRendererInfo = () => {
  const gl = renderer.getContext();
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  return String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
};
window.aagGpuMemory = () => ({
  geometries: renderer.info.memory.geometries,
  textures: renderer.info.memory.textures,
});
window.aagReady = true;
