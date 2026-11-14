import { describe, expect, test } from "bun:test";
import { PerspectiveCamera, Vector3 } from "three";
import {
  AXIS_PRESET,
  type AxisId,
  carryView,
  distanceLimits,
  fitDistance,
  floorVisibility,
  GIZMO_RADIUS,
  gridCellSize,
  nearestPreset,
  normalizeAngle,
  PRESET_IDS,
  PRESETS,
  type PresetId,
  placeView,
  projectAxes,
  shortestAzimuth,
  UNDER_LIGHT_INTENSITY,
  underLightIntensity,
} from "./math.ts";

/** Arah dari target ke kamera untuk sudut (azimuth, polar), dengan konvensi `Spherical` three. */
function direction(id: PresetId): [number, number, number] {
  const { azimuth, polar } = PRESETS[id];
  return [Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth)];
}

function expectVector(actual: readonly number[], expected: readonly number[], digits = 3) {
  expect(actual).toHaveLength(expected.length);
  for (const [index, value] of expected.entries())
    expect(actual[index] ?? Number.NaN).toBeCloseTo(value, digits);
}

/** Matriks dunia → kamera untuk kamera yang melihat titik asal dari `position`. */
function viewMatrix(position: [number, number, number]): number[] {
  const camera = new PerspectiveCamera();
  camera.position.set(...position);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return camera.matrixWorldInverse.elements;
}

describe("sudut cepat", () => {
  test.each([
    ["front", [0, 0, 1]],
    ["back", [0, 0, -1]],
    ["left", [-1, 0, 0]],
    ["right", [1, 0, 0]],
    ["top", [0, 1, 0]],
    ["bottom", [0, -1, 0]],
  ] as const)("%s melihat dari arah %j", (id, expected) => {
    expectVector(direction(id), expected);
  });

  test("3/4 dari kanan-depan, elevasi 22,5° (sama dengan prototipe dan desain)", () => {
    const [x, y, z] = direction("iso");
    const length = Math.hypot(0.9, 0.62, 1.2);
    expectVector([x, y, z], [0.9 / length, 0.62 / length, 1.2 / length]);
    expect(90 - (PRESETS.iso.polar * 180) / Math.PI).toBeCloseTo(22.5, 1);
  });

  test("Atas dan Bawah tidak tepat di kutub, tetapi dalam 1e-3 rad darinya", () => {
    expect(PRESETS.top.polar).toBeGreaterThan(0);
    expect(PRESETS.top.polar).toBeLessThan(1e-3);
    expect(PRESETS.bottom.polar).toBeLessThan(Math.PI);
    expect(Math.PI - PRESETS.bottom.polar).toBeLessThan(1e-3);
  });

  test("bulatan gizmo membuka sudut yang searah dengan sumbunya", () => {
    const axes: Record<AxisId, [number, number, number]> = {
      px: [1, 0, 0],
      nx: [-1, 0, 0],
      py: [0, 1, 0],
      ny: [0, -1, 0],
      pz: [0, 0, 1],
      nz: [0, 0, -1],
    };
    for (const [axis, expected] of Object.entries(axes)) {
      expectVector(direction(AXIS_PRESET[axis as AxisId]), expected);
    }
  });
});

describe("azimuth", () => {
  test("normalisasi ke [0, 2π)", () => {
    expect(normalizeAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 9);
    expect(normalizeAngle(5 * Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(normalizeAngle(0)).toBe(0);
  });

  test.each([
    [(350 * Math.PI) / 180, 0, (360 * Math.PI) / 180],
    [(10 * Math.PI) / 180, (350 * Math.PI) / 180, (-10 * Math.PI) / 180],
    [6 * Math.PI + 0.1, Math.PI / 2, 6 * Math.PI + Math.PI / 2],
    [-4 * Math.PI, -Math.PI / 2, -4 * Math.PI - Math.PI / 2],
  ])("dari %f ke %f lewat jalur terpendek → %f", (current, target, expected) => {
    const result = shortestAzimuth(current, target);
    expect(result).toBeCloseTo(expected, 9);
    expect(Math.abs(result - current)).toBeLessThanOrEqual(Math.PI + 1e-9);
  });
});

describe("sudut cepat terdekat (centang menu Sudut)", () => {
  test.each(PRESET_IDS)("%s dikenali, juga setelah berputar penuh", (id) => {
    expect(nearestPreset(PRESETS[id])).toBe(id);
    expect(nearestPreset({ ...PRESETS[id], azimuth: PRESETS[id].azimuth + 4 * Math.PI })).toBe(id);
  });

  test("selisih 1° masih dianggap sudut cepat, 5° tidak", () => {
    const degree = Math.PI / 180;
    expect(nearestPreset({ azimuth: degree, polar: Math.PI / 2 })).toBe("front");
    expect(nearestPreset({ azimuth: 5 * degree, polar: Math.PI / 2 })).toBeNull();
    expect(nearestPreset({ azimuth: 0, polar: Math.PI / 2 - 5 * degree })).toBeNull();
  });

  test("Atas/Bawah tidak bergantung pada azimuth", () => {
    expect(nearestPreset({ azimuth: 2.5, polar: 0.01 })).toBe("top");
    expect(nearestPreset({ azimuth: -1, polar: Math.PI - 0.01 })).toBe("bottom");
  });
});

describe("bingkai dan batas zoom", () => {
  test("bola batas × 1,2 muat di sudut pandang vertikal bila area melebar", () => {
    expect(fitDistance(1, 30, 2)).toBeCloseTo(1.2 / Math.sin((15 * Math.PI) / 180), 9);
  });

  test("area sempit memakai sudut pandang horizontal (jarak lebih jauh)", () => {
    const narrow = fitDistance(1, 30, 0.5);
    const horizontal = 2 * Math.atan(Math.tan((15 * Math.PI) / 180) * 0.5);
    expect(narrow).toBeCloseTo(1.2 / Math.sin(horizontal / 2), 9);
    expect(narrow).toBeGreaterThan(fitDistance(1, 30, 2));
  });

  test("zoom dibatasi dari ukuran model", () => {
    expect(distanceLimits(0.5, 2)).toEqual({ min: 0.525, max: 6 });
    expect(distanceLimits(0.5, 0.6)).toEqual({ min: 0.525, max: 3 });
  });
});

describe("sudut pandang antar-versi", () => {
  const oldModel = { center: [0, 0.3, 0] as const, radius: 0.5 };

  test("sudut tetap; jarak dan geser pusat pandang ikut ukuran model baru", () => {
    const carried = carryView(
      { azimuth: 1.1, polar: 0.9, distance: 3, target: [0.1, 0.4, -0.05] },
      oldModel,
      2,
    );
    expect(carried).not.toBeNull();
    const placed = placeView(carried, { center: [1, 0.6, 0], radius: 1 }, 4, { min: 1.05, max: 12 });
    expect(placed.azimuth).toBe(1.1);
    expect(placed.polar).toBe(0.9);
    // 3 / 2 × 4: jarak relatif terhadap jarak bingkai sama.
    expect(placed.distance).toBeCloseTo(6, 9);
    // Selisih (0,1; 0,1; −0,05) / 0,5 × 1 dari pusat baru.
    expectVector(placed.target, [1.2, 0.8, -0.1], 9);
  });

  test("jarak dijepit ke batas zoom model baru", () => {
    const carried = carryView({ azimuth: 0, polar: 1, distance: 6, target: [0, 0.3, 0] }, oldModel, 2);
    expect(placeView(carried, { center: [0, 0, 0], radius: 0.5 }, 2, { min: 0.525, max: 4 }).distance).toBe(
      4,
    );
  });

  test("tanpa sudut pandang sebelumnya (atau datanya rusak): sudut 3/4 dengan model dibingkai", () => {
    const limits = { min: 0.525, max: 6 };
    const model = { center: [0, 0.2, 0] as const, radius: 0.5 };
    const iso = {
      azimuth: PRESETS.iso.azimuth,
      polar: PRESETS.iso.polar,
      distance: 2,
      target: [0, 0.2, 0] as const,
    };
    expect(placeView(null, model, 2, limits)).toEqual(iso);
    expect(
      carryView({ azimuth: Number.NaN, polar: 1, distance: 3, target: [0, 0, 0] }, oldModel, 2),
    ).toBeNull();
    expect(carryView({ azimuth: 1, polar: 1, distance: 3, target: [0, 0, 0] }, oldModel, 0)).toBeNull();
    expect(
      carryView({ azimuth: 1, polar: 1, distance: 3, target: [0, 0, 0] }, { ...oldModel, radius: 0 }, 2),
    ).toBeNull();
  });
});

describe("lantai", () => {
  test("terlihat penuh di atas pita, memudar mendekati lantai, hilang di bawahnya", () => {
    expect(floorVisibility(1, 0.4)).toBe(1);
    expect(floorVisibility(0.05, 0.4)).toBeCloseTo(0.5, 9);
    expect(floorVisibility(0, 0.4)).toBe(0);
    expect(floorVisibility(-2, 0.4)).toBe(0);
  });

  test("lampu bawah menyala penuh saat lantai hilang", () => {
    expect(underLightIntensity(0)).toBe(UNDER_LIGHT_INTENSITY);
    expect(underLightIntensity(1)).toBe(0);
    expect(underLightIntensity(0.5)).toBeCloseTo(UNDER_LIGHT_INTENSITY / 2, 9);
  });

  test.each([
    [0.65, 0.2],
    [0.82, 0.2],
    [5, 2],
    [0.1, 0.05],
    [30, 10],
    [1.5, 0.5],
  ])("model %f m → sel grid %f m", (size, cell) => {
    expect(gridCellSize(size)).toBe(cell);
  });
});

describe("gizmo sumbu", () => {
  const byId = (axes: ReturnType<typeof projectAxes>, id: AxisId) => {
    const axis = axes.find((item) => item.id === id);
    if (!axis) throw new Error(`sumbu ${id} tidak ada`);
    return axis;
  };

  test("tampak depan: X ke kanan, Y ke atas, Z ke arah kamera", () => {
    const axes = projectAxes(viewMatrix([0, 0, 5]));
    expectVector([byId(axes, "px").x, byId(axes, "px").y], [GIZMO_RADIUS, 0]);
    expectVector([byId(axes, "py").x, byId(axes, "py").y], [0, -GIZMO_RADIUS]);
    expect(byId(axes, "pz").depth).toBeCloseTo(1, 9);
    expect(byId(axes, "nz").depth).toBeCloseTo(-1, 9);
    expect(byId(axes, "px").depth).toBeCloseTo(0, 9);
  });

  test("tampak kanan: Z (depan) ke kiri layar, X ke arah kamera", () => {
    const axes = projectAxes(viewMatrix([5, 0, 0]));
    expect(byId(axes, "pz").x).toBeCloseTo(-GIZMO_RADIUS, 6);
    expect(byId(axes, "px").depth).toBeCloseTo(1, 9);
    expect(byId(axes, "nx").depth).toBeCloseTo(-1, 9);
  });

  test("tampak 3/4: tiga sumbu negatif menjauh (digambar di bawah), sama dengan desain", () => {
    const [x, y, z] = direction("iso");
    const axes = projectAxes(viewMatrix([x * 5, y * 5, z * 5]));
    expect(axes.filter((axis) => axis.depth < 0).map((axis) => axis.id)).toEqual(["nx", "ny", "nz"]);
    // Desain: bulatan Y 31,4 px di atas pusat.
    expect(byId(axes, "py").y).toBeCloseTo(-31.4, 1);
    expect(new Vector3(byId(axes, "px").x, byId(axes, "px").y, 0).length()).toBeGreaterThan(20);
  });
});
