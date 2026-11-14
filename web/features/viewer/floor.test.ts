import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { createGridMaterial, gridFade, setRawColor } from "./floor.ts";

describe("gridFade", () => {
  test("jarak pudar dan luas lantai sebanding ukuran model (prototipe: 1,3–3,5 m untuk radius 0,5 m)", () => {
    const half = gridFade(0.5);
    expect(half.near).toBeCloseTo(1.3, 9);
    expect(half.far).toBeCloseTo(3.55, 9);
    const double = gridFade(1);
    expect(double.near).toBeCloseTo(half.near * 2, 9);
    expect(double.far).toBeCloseTo(half.far * 2, 9);
    // Lantai lebih luas dari jarak pudar, jadi tepinya tidak pernah terlihat.
    expect(double.extent / 2).toBeGreaterThan(double.far);
  });
});

describe("setRawColor", () => {
  test("hex token disalin apa adanya, tanpa konversi sRGB ke linear", () => {
    const color = new THREE.Color();
    setRawColor(color, "#3a3a40");
    expect(color.r).toBeCloseTo(0x3a / 255, 9);
    expect(color.g).toBeCloseTo(0x3a / 255, 9);
    expect(color.b).toBeCloseTo(0x40 / 255, 9);
  });
});

describe("createGridMaterial", () => {
  test("transparan tanpa menulis depth; uniform yang diisi viewer tersedia", () => {
    const material = createGridMaterial();
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(Object.keys(material.uniforms).sort()).toEqual(
      ["uCell", "uCenter", "uFar", "uMajor", "uMinor", "uNear", "uOpacity"].sort(),
    );
  });
});
