import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import { RADII, TEXT_STYLES } from "@/styles/tokens.ts";

/**
 * tailwind-merge perlu mengenal nama text style dan radius dari FigCraft. Tanpa ini, `text-body` dianggap warna
 * dan bertabrakan dengan `text-text-primary`.
 */
const twMerge = extendTailwindMerge({
  extend: { theme: { text: [...TEXT_STYLES], radius: [...RADII] } },
});

/** Menggabungkan kelas Tailwind; kelas yang bertabrakan dimenangkan yang terakhir. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
