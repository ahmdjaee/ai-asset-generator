import type * as THREE from "three";

/**
 * Geser pusat proyeksi ke tengah area yang tidak tertutup panel, tanpa mengubah sudut pandang vertikal: kamera
 * memotret bidang selebar `width + 2·shift` dan kanvas menampilkan potongan kanannya. Kamera dibuat `manual`, jadi
 * R3F tidak mengatur `aspect`: `setViewOffset` three mengaturnya ke bidang penuh, dan saat offset dilepas aspect
 * dikembalikan ke ukuran kanvas di sini.
 */
export function applyViewOffset(
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
  inset: number,
): void {
  const shift = Math.min(Math.max(inset, 0), width / 2) / 2;
  if (shift > 0) {
    camera.setViewOffset(width + 2 * shift, height, 2 * shift, 0, width, height);
    return;
  }
  camera.clearViewOffset();
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
}
