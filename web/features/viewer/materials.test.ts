import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { SCENE_LIGHTING } from "../../../shared/scene.ts";
import { disposeTree, environmentIntensity, ModeMaterials } from "./materials.ts";

/** Mencatat objek yang dibuang lewat event `dispose` three. */
function disposals(...items: THREE.EventDispatcher<{ dispose: object }>[]): () => number {
  let count = 0;
  for (const item of items) item.addEventListener("dispose", () => (count += 1));
  return () => count;
}

describe("environmentIntensity", () => {
  test("mode Tekstur memakai cahaya lingkungan contact sheet, mode polos lebih redup", () => {
    expect(environmentIntensity("texture")).toBe(SCENE_LIGHTING.environment.texture);
    for (const mode of ["clay", "uv", "normal"] as const) {
      expect(environmentIntensity(mode)).toBe(SCENE_LIGHTING.environment.plain);
    }
  });
});

describe("ModeMaterials", () => {
  test("Tekstur = material asli; Clay = satu material clay bersama", () => {
    const materials = new ModeMaterials();
    const original = new THREE.MeshStandardMaterial();
    expect(materials.forMode("texture", original)).toBe(original);
    expect(materials.forMode("clay", original)).toBe(materials.clay);
    expect(materials.forMode("clay", [original, original])).toBe(materials.clay);
  });

  test("Normal memakai normal map aset (dibuat sekali per map); tanpa map memakai material normal polos", () => {
    const materials = new ModeMaterials();
    const normalMap = new THREE.Texture();
    const withMap = new THREE.MeshStandardMaterial({ normalMap, normalScale: new THREE.Vector2(0.5, 0.5) });
    const first = materials.forMode("normal", withMap);
    if (!(first instanceof THREE.MeshNormalMaterial)) throw new Error("bukan MeshNormalMaterial");
    expect(first.normalMap).toBe(normalMap);
    expect(first.normalScale.toArray()).toEqual([0.5, 0.5]);
    expect(materials.forMode("normal", withMap)).toBe(first);
    const plain = materials.forMode("normal", new THREE.MeshStandardMaterial());
    expect(plain).toBeInstanceOf(THREE.MeshNormalMaterial);
    expect(plain).not.toBe(first);
    // Mesh multi-material tetap mendapat array.
    const many = materials.forMode("normal", [withMap, new THREE.MeshBasicMaterial()]);
    expect(Array.isArray(many) && many.length === 2 && many[0] === first).toBe(true);
  });

  test("dispose membuang material buatannya, bukan normal map milik model", () => {
    const materials = new ModeMaterials();
    const normalMap = new THREE.Texture();
    const normal = materials.forMode("normal", new THREE.MeshStandardMaterial({ normalMap }));
    if (Array.isArray(normal)) throw new Error("tidak diharapkan array");
    const created = disposals(materials.clay, materials.wire, normal);
    const map = disposals(normalMap);
    materials.dispose();
    expect(created()).toBe(3);
    expect(map()).toBe(0);
  });
});

describe("disposeTree", () => {
  test("membuang geometri, material, dan tekstur semua mesh dan garis di pohon objek", () => {
    const texture = new THREE.Texture();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: texture }));
    const lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
    const root = new THREE.Group();
    root.add(mesh);
    mesh.add(lines);
    const count = disposals(mesh.geometry, mesh.material, texture, lines.geometry, lines.material);
    disposeTree(root);
    expect(count()).toBe(5);
  });
});
