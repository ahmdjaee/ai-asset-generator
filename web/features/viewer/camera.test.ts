import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { applyViewOffset } from "./camera.ts";

const WIDTH = 976;
const HEIGHT = 848;

function cameraAt(fov = 30): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

/** Posisi piksel kanvas sebuah titik dunia. */
function toPixels(camera: THREE.PerspectiveCamera, point: THREE.Vector3): [number, number] {
  const ndc = point.clone().project(camera);
  return [((ndc.x + 1) / 2) * WIDTH, ((1 - ndc.y) / 2) * HEIGHT];
}

describe("applyViewOffset", () => {
  for (const inset of [0, 296, 600]) {
    test(`inset ${inset}: satu satuan horizontal = satu satuan vertikal di layar (tidak teregang)`, () => {
      const camera = cameraAt();
      applyViewOffset(camera, WIDTH, HEIGHT, inset);
      const [cx, cy] = toPixels(camera, new THREE.Vector3(0, 0, 0));
      const [rx] = toPixels(camera, new THREE.Vector3(1, 0, 0));
      const [, uy] = toPixels(camera, new THREE.Vector3(0, 1, 0));
      expect(rx - cx).toBeCloseTo(cy - uy, 6);
    });
  }

  test("pusat pandang bergeser ke tengah area kiri panel; sudut pandang vertikal tetap", () => {
    const camera = cameraAt();
    applyViewOffset(camera, WIDTH, HEIGHT, 296);
    const [cx, cy] = toPixels(camera, new THREE.Vector3(0, 0, 0));
    expect(cx).toBeCloseTo((WIDTH - 296) / 2, 6);
    expect(cy).toBeCloseTo(HEIGHT / 2, 6);
    // Titik di tepi atas bidang pandang 30° tetap di tepi atas kanvas.
    const [, top] = toPixels(camera, new THREE.Vector3(0, 10 * Math.tan(THREE.MathUtils.degToRad(15)), 0));
    expect(top).toBeCloseTo(0, 6);
  });

  test("panel lebih lebar dari separuh viewer: geser dibatasi seperempat lebar", () => {
    const camera = cameraAt();
    applyViewOffset(camera, WIDTH, HEIGHT, WIDTH);
    const [cx] = toPixels(camera, new THREE.Vector3(0, 0, 0));
    expect(cx).toBeCloseTo(WIDTH / 4, 6);
  });

  test("panel ditutup: view offset dilepas, aspect = kanvas", () => {
    const camera = cameraAt();
    applyViewOffset(camera, WIDTH, HEIGHT, 296);
    applyViewOffset(camera, WIDTH, HEIGHT, 0);
    expect(camera.view?.enabled ?? false).toBe(false);
    expect(camera.aspect).toBeCloseTo(WIDTH / HEIGHT, 9);
  });
});
