import { createLucideIcon } from "lucide-react";

/**
 * `Icon/axis-3d` FigCraft: siku sumbu dan satu diagonal utuh, geometri `axis-3d` Lucide versi lama. lucide-react 1.72
 * menggambar diagonalnya putus-putus dan sikunya membulat, jadi geometri desain ditulis di sini. Dibuat lewat
 * `createLucideIcon`, sehingga ketebalan garis dari `LucideProvider` dan `aria-hidden` otomatis tetap berlaku.
 */
export const Axis3dIcon = createLucideIcon("axis-3d-figcraft", [
  ["path", { d: "M4 4v16h16", key: "siku" }],
  ["path", { d: "m4 20 7-7", key: "diagonal" }],
]);
