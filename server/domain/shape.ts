/**
 * Cek konsistensi bentuk aset final terhadap bentuk dasar yang disetujui (fungsi murni).
 * Aset final boleh menambah UV, material, dan tekstur, tetapi ukuran dan kepadatan mesh harus tetap.
 */
import { SHAPE_TOLERANCE } from "../../shared/limits.ts";

export type ShapeStats = Readonly<{
  triangles: number;
  /** Ukuran bbox (m) pada sumbu x, y, z. */
  size: readonly [number, number, number];
}>;

export type ShapeTolerance = Readonly<{
  bboxRelative: number;
  bboxAbsoluteM: number;
  trianglesRelative: number;
}>;

export type ShapeIssue = Readonly<{
  key: "size.x" | "size.y" | "size.z" | "triangles";
  approved: number;
  candidate: number;
  /** Selisih relatif terhadap nilai yang disetujui (0,1 = 10%). */
  relative: number;
}>;

export type ShapeCheck = Readonly<{ ok: boolean; issues: readonly ShapeIssue[] }>;

const AXES = ["size.x", "size.y", "size.z"] as const;

function relativeDiff(approved: number, candidate: number): number {
  if (approved === 0) return candidate === 0 ? 0 : Number.POSITIVE_INFINITY;
  return Math.abs(candidate - approved) / approved;
}

export function checkShape(
  approved: ShapeStats,
  candidate: ShapeStats,
  tolerance: ShapeTolerance = SHAPE_TOLERANCE,
): ShapeCheck {
  const issues: ShapeIssue[] = [];
  AXES.forEach((key, axis) => {
    const a = approved.size[axis] ?? 0;
    const c = candidate.size[axis] ?? 0;
    const relative = relativeDiff(a, c);
    if (Math.abs(c - a) > tolerance.bboxAbsoluteM && relative > tolerance.bboxRelative) {
      issues.push({ key, approved: a, candidate: c, relative });
    }
  });
  const relative = relativeDiff(approved.triangles, candidate.triangles);
  if (relative > tolerance.trianglesRelative) {
    issues.push({ key: "triangles", approved: approved.triangles, candidate: candidate.triangles, relative });
  }
  return { ok: issues.length === 0, issues };
}
