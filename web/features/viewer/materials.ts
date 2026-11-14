import * as THREE from "three";
import { SCENE_LIGHTING, SCENE_MATERIALS } from "../../../shared/scene.ts";

/** Mode shading toolbar. Wireframe adalah lapisan terpisah di atas mode apa pun. */
export const SHADING_MODES = ["texture", "clay", "uv", "normal"] as const;
export type ShadingMode = (typeof SHADING_MODES)[number];

/** Intensitas cahaya lingkungan per mode, sama dengan contact sheet (Tekstur lebih terang). */
export function environmentIntensity(mode: ShadingMode): number {
  return mode === "texture" ? SCENE_LIGHTING.environment.texture : SCENE_LIGHTING.environment.plain;
}

/** Tekstur pola kotak untuk mode UV: regangan dan sambungan UV terlihat dari ukuran dan arah kotak. */
function createCheckerTexture(): THREE.CanvasTexture {
  const { light, dark, cells, repeat } = SCENE_MATERIALS.checker;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Canvas 2D tidak tersedia untuk pola kotak UV");
  const cell = size / cells;
  for (let row = 0; row < cells; row++) {
    for (let column = 0; column < cells; column++) {
      context.fillStyle = (row + column) % 2 === 0 ? light : dark;
      context.fillRect(column * cell, row * cell, cell, cell);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 4;
  return texture;
}

function texturesOf(material: THREE.Material): THREE.Texture[] {
  return Object.values(material).filter((value): value is THREE.Texture => value instanceof THREE.Texture);
}

export function materialList(material: THREE.Material | THREE.Material[]): THREE.Material[] {
  return Array.isArray(material) ? material : [material];
}

/**
 * Material pengganti untuk mode Clay, UV, Normal, dan garis wireframe. Dibuat sekali per viewer dan dibuang saat
 * viewer dilepas. Material asli model (mode Tekstur) tidak diubah.
 */
export class ModeMaterials {
  readonly clay = new THREE.MeshStandardMaterial({ ...SCENE_MATERIALS.clay });
  readonly wire = new THREE.LineBasicMaterial({ ...SCENE_MATERIALS.wire, transparent: true });
  private checker: THREE.CanvasTexture | null = null;
  private uvMaterial: THREE.MeshStandardMaterial | null = null;
  private readonly plainNormal = new THREE.MeshNormalMaterial();
  /** Mode Normal memakai normal map aset final bila ada, supaya detail hasil bake ikut terlihat. */
  private readonly normalByMap = new Map<THREE.Texture, THREE.MeshNormalMaterial>();

  forMode(mode: ShadingMode, original: THREE.Material | THREE.Material[]): THREE.Material | THREE.Material[] {
    switch (mode) {
      case "texture":
        return original;
      case "clay":
        return this.clay;
      case "uv":
        return this.uv();
      case "normal": {
        const normals = materialList(original).map((material) => this.normal(material));
        return Array.isArray(original) ? normals : (normals[0] ?? this.plainNormal);
      }
    }
  }

  private uv(): THREE.MeshStandardMaterial {
    if (this.uvMaterial === null) {
      this.checker = createCheckerTexture();
      this.uvMaterial = new THREE.MeshStandardMaterial({
        ...SCENE_MATERIALS.clay,
        color: "#ffffff",
        map: this.checker,
      });
    }
    return this.uvMaterial;
  }

  private normal(material: THREE.Material): THREE.MeshNormalMaterial {
    if (!(material instanceof THREE.MeshStandardMaterial) || material.normalMap === null)
      return this.plainNormal;
    const cached = this.normalByMap.get(material.normalMap);
    if (cached) return cached;
    const created = new THREE.MeshNormalMaterial({
      normalMap: material.normalMap,
      normalScale: material.normalScale.clone(),
    });
    this.normalByMap.set(material.normalMap, created);
    return created;
  }

  dispose(): void {
    this.clay.dispose();
    this.wire.dispose();
    this.plainNormal.dispose();
    this.uvMaterial?.dispose();
    this.checker?.dispose();
    // Normal map milik model asli; dibuang bersama model, bukan di sini.
    for (const material of this.normalByMap.values()) material.dispose();
    this.normalByMap.clear();
  }
}

/** Membuang geometri, material, dan tekstur sebuah pohon objek (model yang sudah tidak dipakai). */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      object.geometry.dispose();
      for (const material of materialList(object.material)) {
        for (const texture of texturesOf(material)) texture.dispose();
        material.dispose();
      }
    }
  });
}
