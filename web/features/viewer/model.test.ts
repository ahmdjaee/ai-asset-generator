import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { createWireframes, type LoadedGltf, prepareModel } from "./model.ts";

function loaded(json: unknown, ...meshes: THREE.Mesh[]): LoadedGltf {
  const scene = new THREE.Group();
  for (const mesh of meshes) scene.add(mesh);
  return { scene, parser: { json } };
}

/** Kotak 2 × 1 × 1 yang alasnya di y = 0. */
function crate(): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1), new THREE.MeshStandardMaterial());
  mesh.position.y = 0.5;
  return mesh;
}

function firstMesh(meshes: readonly THREE.Mesh[]): THREE.Mesh {
  const mesh = meshes[0];
  if (!mesh) throw new Error("model tanpa mesh");
  return mesh;
}

describe("prepareModel", () => {
  test("statistik, ukuran, pusat bola batas, dan tinggi lantai", () => {
    const model = prepareModel(loaded({ materials: [{}] }, crate()));
    expect(model.info).toEqual({ triangles: 12, vertices: 24, hasMaterials: true, hasUv: true });
    expect(model.size.toArray()).toEqual([2, 1, 1]);
    expect(model.center.x).toBeCloseTo(0, 9);
    expect(model.center.y).toBeCloseTo(0.5, 9);
    expect(model.radius).toBeCloseTo(Math.sqrt(1.5), 9);
    expect(model.floorY).toBeCloseTo(0, 9);
  });

  test("salinan adegan: material salinan bisa ditukar tanpa mengubah cache loader; geometri dibagi", () => {
    const original = crate();
    const model = prepareModel(loaded({ materials: [{}] }, original));
    const mesh = firstMesh(model.meshes);
    expect(mesh).not.toBe(original);
    expect(mesh.geometry).toBe(original.geometry);
    expect(mesh.castShadow).toBe(true);
    mesh.material = new THREE.MeshBasicMaterial();
    expect(original.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(model.originals.get(mesh)).toBe(original.material);
  });

  test("bentuk dasar tanpa material dan tanpa UV: Tekstur dan UV tidak tersedia", () => {
    const geometry = new THREE.BoxGeometry();
    geometry.deleteAttribute("uv");
    const model = prepareModel(loaded({}, new THREE.Mesh(geometry)));
    expect(model.info.hasMaterials).toBe(false);
    expect(model.info.hasUv).toBe(false);
  });

  test("JSON glTF yang tidak sesuai skema dianggap tanpa material", () => {
    expect(prepareModel(loaded("bukan objek", crate())).info.hasMaterials).toBe(false);
    expect(prepareModel(loaded({ materials: "x" }, crate())).info.hasMaterials).toBe(false);
  });

  test("geometri tanpa indeks: segitiga dihitung dari jumlah posisi", () => {
    const geometry = new THREE.BoxGeometry().toNonIndexed();
    const model = prepareModel(loaded({}, new THREE.Mesh(geometry)));
    expect(model.info.triangles).toBe(12);
    expect(model.info.vertices).toBe(36);
  });

  test("model kosong: radius minimum dan lantai di 0, tanpa pembagian dengan nol", () => {
    const model = prepareModel(loaded({}));
    expect(model.radius).toBe(1e-3);
    expect(model.floorY).toBe(0);
    expect(model.info).toEqual({ triangles: 0, vertices: 0, hasMaterials: false, hasUv: false });
  });
});

describe("createWireframes", () => {
  test("garis sebagai anak tiap mesh, tidak ikut raycast, tanpa bayangan, satu material bersama", () => {
    const model = prepareModel(loaded({}, crate(), crate()));
    const material = new THREE.LineBasicMaterial();
    const lines = createWireframes(model.meshes, material);
    expect(lines.map((line) => line.parent)).toEqual([...model.meshes]);
    expect(lines.every((line) => line.material === material && !line.castShadow)).toBe(true);
    const hits: THREE.Intersection[] = [];
    const first = lines[0];
    if (!first) throw new Error("tanpa garis");
    first.raycast(new THREE.Raycaster(new THREE.Vector3(0, 0.5, 5), new THREE.Vector3(0, 0, -1)), hits);
    expect(hits).toHaveLength(0);
  });
});
