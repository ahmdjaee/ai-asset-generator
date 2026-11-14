import * as THREE from "three";
import { z } from "zod";

/** Info model yang dipakai toolbar (mode yang tersedia) dan test hook. */
export type ModelInfo = Readonly<{
  triangles: number;
  vertices: number;
  /** GLB punya material sendiri (aset final). Bentuk dasar diekspor tanpa material, jadi mode Tekstur nonaktif. */
  hasMaterials: boolean;
  /** Semua mesh punya UV, jadi mode UV bisa dipakai. */
  hasUv: boolean;
}>;

export type PreparedModel = Readonly<{
  /** Salinan adegan GLB: material bisa ditukar tanpa mengubah cache loader. */
  root: THREE.Group;
  meshes: readonly THREE.Mesh[];
  originals: ReadonlyMap<THREE.Mesh, THREE.Material | THREE.Material[]>;
  center: THREE.Vector3;
  radius: number;
  size: THREE.Vector3;
  /** Tinggi lantai = sisi bawah kotak batas model. */
  floorY: number;
  info: ModelInfo;
}>;

/** Bagian hasil `useGLTF` yang dipakai viewer (tipe struktural, tanpa bergantung langsung pada three-stdlib). */
export type LoadedGltf = Readonly<{ scene: THREE.Group; parser: Readonly<{ json: unknown }> }>;

/** JSON glTF hanya dibaca untuk daftar material; sisanya sudah diurai loader. */
const GltfJson = z.object({ materials: z.array(z.unknown()).optional() });

function triangleCount(geometry: THREE.BufferGeometry): number {
  const vertices = geometry.getAttribute("position")?.count ?? 0;
  return (geometry.index?.count ?? vertices) / 3;
}

export function prepareModel(gltf: LoadedGltf): PreparedModel {
  const root = gltf.scene.clone(true);
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  const originals = new Map(meshes.map((mesh) => [mesh, mesh.material] as const));
  for (const mesh of meshes) {
    mesh.castShadow = true;
    mesh.receiveShadow = false;
  }

  const box = new THREE.Box3().setFromObject(root);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const size = box.getSize(new THREE.Vector3());
  const json = GltfJson.safeParse(gltf.parser.json);
  const triangles = meshes.reduce((total, mesh) => total + triangleCount(mesh.geometry), 0);
  const vertices = meshes.reduce(
    (total, mesh) => total + (mesh.geometry.getAttribute("position")?.count ?? 0),
    0,
  );

  return {
    root,
    meshes,
    originals,
    center: sphere.center,
    // Model kosong atau satu titik tetap punya radius supaya kamera dan lantai tidak membagi dengan nol.
    radius: Math.max(sphere.radius, 1e-3),
    size,
    floorY: box.isEmpty() ? 0 : box.min.y,
    info: {
      triangles: Math.round(triangles),
      vertices,
      hasMaterials: json.success && (json.data.materials?.length ?? 0) > 0,
      hasUv: meshes.length > 0 && meshes.every((mesh) => mesh.geometry.getAttribute("uv") !== undefined),
    },
  };
}

/** Garis wireframe sebagai anak tiap mesh; tidak ikut raycast (klik dua kali) dan tidak memberi bayangan. */
export function createWireframes(
  meshes: readonly THREE.Mesh[],
  material: THREE.LineBasicMaterial,
): THREE.LineSegments[] {
  return meshes.map((mesh) => {
    const lines = new THREE.LineSegments(new THREE.WireframeGeometry(mesh.geometry), material);
    lines.raycast = () => undefined;
    lines.castShadow = false;
    mesh.add(lines);
    return lines;
  });
}
