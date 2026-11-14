import * as THREE from "three";

/**
 * Grid lantai sebagai shader (port dari prototipe `viewer-360.html`): garis halus per sel dan garis tebal tiap
 * 5 sel, memudar menjauhi model, dan ikut memudar bersama lantai saat kamera turun. `GridHelper` tidak dipakai
 * karena SwiftShader hanya menggambar satu arah garisnya.
 */
const VERTEX = /* glsl */ `
varying vec3 vPos;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 uMinor;
uniform vec3 uMajor;
uniform float uCell;
uniform float uNear;
uniform float uFar;
uniform float uOpacity;
uniform vec2 uCenter;
varying vec3 vPos;
float gridLine(vec2 p, float cell, float width) {
  vec2 c = p / cell;
  vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c);
  return 1.0 - min(min(g.x, g.y) / width, 1.0);
}
void main() {
  float minor = gridLine(vPos.xz, uCell, 1.0);
  float major = gridLine(vPos.xz, uCell * 5.0, 1.4);
  float fade = 1.0 - smoothstep(uNear, uFar, length(vPos.xz - uCenter));
  float alpha = max(minor, major) * fade * uOpacity;
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(mix(uMinor, uMajor, major), alpha);
}`;

export type GridUniforms = {
  uMinor: { value: THREE.Color };
  uMajor: { value: THREE.Color };
  uCell: { value: number };
  uNear: { value: number };
  uFar: { value: number };
  uOpacity: { value: number };
  uCenter: { value: THREE.Vector2 };
};

export function createGridMaterial(): THREE.ShaderMaterial & { uniforms: GridUniforms } {
  const uniforms: GridUniforms = {
    uMinor: { value: new THREE.Color() },
    uMajor: { value: new THREE.Color() },
    uCell: { value: 0.2 },
    uNear: { value: 1 },
    uFar: { value: 3 },
    uOpacity: { value: 1 },
    uCenter: { value: new THREE.Vector2() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
  return Object.assign(material, { uniforms });
}

/**
 * Warna token (hex sRGB) untuk shader yang menulis warna apa adanya: dibaca sebagai "linear" supaya three tidak
 * mengonversinya, sehingga piksel garis sama persis dengan token.
 */
export function setRawColor(target: THREE.Color, hex: string): void {
  target.setStyle(hex, THREE.LinearSRGBColorSpace);
}

/** Opasitas bayangan di lantai per tema (prototipe): tema terang butuh bayangan lebih tipis. */
export const SHADOW_OPACITY = { dark: 0.42, light: 0.22 } as const;

/** Jarak pudar grid dari pusat model, sebanding ukuran model (prototipe: 1,3–3,5 m untuk radius 0,5 m). */
export function gridFade(radius: number): Readonly<{ near: number; far: number; extent: number }> {
  const near = radius * 2.6;
  const far = near + radius * 4.5;
  return { near, far, extent: far * 2.5 };
}
