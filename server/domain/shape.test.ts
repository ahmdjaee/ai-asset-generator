import { describe, expect, test } from "bun:test";
import { checkShape, type ShapeIssue, type ShapeStats } from "./shape.ts";

const base: ShapeStats = { triangles: 1000, size: [1, 2, 0.5] };

describe("checkShape", () => {
  test.each<[string, ShapeStats, ShapeIssue["key"][]]>([
    ["sama persis", base, []],
    ["bbox +4% di semua sumbu", { triangles: 1000, size: [1.04, 2.08, 0.52] }, []],
    ["bbox x +6%", { triangles: 1000, size: [1.06, 2, 0.5] }, ["size.x"]],
    ["bbox y −10%", { triangles: 1000, size: [1, 1.8, 0.5] }, ["size.y"]],
    ["sisi tipis berubah 8 mm (di bawah batas absolut 1 cm)", { triangles: 1000, size: [1, 2, 0.508] }, []],
    [
      "sisi tipis berubah 2 cm (lewat batas absolut, tetapi masih 4%)",
      { triangles: 1000, size: [1, 2, 0.52] },
      [],
    ],
    ["sisi tipis berubah 3 cm", { triangles: 1000, size: [1, 2, 0.53] }, ["size.z"]],
    ["segitiga +25% (batas)", { triangles: 1250, size: [1, 2, 0.5] }, []],
    ["segitiga +26%", { triangles: 1260, size: [1, 2, 0.5] }, ["triangles"]],
    ["segitiga −40% (simplify berlebihan)", { triangles: 600, size: [1, 2, 0.5] }, ["triangles"]],
    [
      "bentuk lain sama sekali",
      { triangles: 5000, size: [3, 3, 3] },
      ["size.x", "size.y", "size.z", "triangles"],
    ],
  ])("%s", (_label, candidate, keys) => {
    const result = checkShape(base, candidate);
    expect(result.issues.map((issue) => issue.key)).toEqual(keys);
    expect(result.ok).toBe(keys.length === 0);
  });

  test("selisih relatif dilaporkan", () => {
    const [issue] = checkShape(base, { triangles: 1000, size: [1.5, 2, 0.5] }).issues;
    expect(issue).toEqual({ key: "size.x", approved: 1, candidate: 1.5, relative: 0.5 });
  });

  test("bentuk dasar tanpa segitiga hanya cocok dengan nol", () => {
    const empty: ShapeStats = { triangles: 0, size: [0, 0, 0] };
    expect(checkShape(empty, empty).ok).toBe(true);
    expect(checkShape(empty, { triangles: 10, size: [0, 0, 0] }).issues[0]?.relative).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  test("toleransi bisa disuntikkan", () => {
    const strict = { bboxRelative: 0, bboxAbsoluteM: 0, trianglesRelative: 0 };
    expect(checkShape(base, { triangles: 1001, size: [1, 2, 0.5] }, strict).ok).toBe(false);
  });
});
