import { isTypingTarget } from "@/lib/keyboard.ts";
import { KEYBOARD_DOLLY_FACTOR, KEYBOARD_ROTATE_STEP } from "./math.ts";

/** Pintasan keyboard viewer (tanpa modifier), sama dengan prototipe dan tooltip toolbar. */
export const VIEWER_SHORTCUTS = {
  spin: "R",
  focus: "F",
  wireframe: "W",
  grid: "G",
  light: "L",
} as const;

export type ShortcutAction = keyof typeof VIEWER_SHORTCUTS;

const BY_KEY: ReadonlyMap<string, ShortcutAction> = new Map(
  Object.entries(VIEWER_SHORTCUTS).map(([action, key]) => [key.toLowerCase(), action as ShortcutAction]),
);

type KeyLike = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "altKey" | "repeat" | "target" | "defaultPrevented"
>;

/** Aksi untuk satu tekanan tombol, atau `null` bila bukan pintasan viewer. Tahan tombol (repeat) tidak mengulang toggle. */
export function shortcutAction(event: KeyLike): ShortcutAction | null {
  if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return null;
  if (isTypingTarget(event.target)) return null;
  return BY_KEY.get(event.key.toLowerCase()) ?? null;
}

/** Aksi kamera dari satu tombol saat kanvas difokus. */
export type ViewportKeyAction =
  | Readonly<{ kind: "rotate"; azimuth: number; polar: number }>
  | Readonly<{ kind: "truck"; x: number; y: number }>
  | Readonly<{ kind: "dolly"; factor: number }>;

type ViewportKey = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

/** Arah panah seperti menyeret ke arah itu: panah kiri memutar (atau menggeser) model ke kiri. */
const ARROWS: ReadonlyMap<string, readonly [number, number]> = new Map([
  ["ArrowLeft", [1, 0]],
  ["ArrowRight", [-1, 0]],
  ["ArrowUp", [0, 1]],
  ["ArrowDown", [0, -1]],
]);

/**
 * Panah memutar, Shift + panah menggeser (sama dengan Shift + seret), plus/minus zoom. Kombinasi Ctrl, Alt, atau Meta
 * milik browser dan sistem (Ctrl + minus memperkecil halaman, Alt + panah kiri kembali), jadi tidak ditangkap. Shift
 * tetap boleh untuk zoom karena "+" di keyboard US butuh Shift.
 */
export function viewportKeyAction(event: ViewportKey): ViewportKeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const arrow = ARROWS.get(event.key);
  if (arrow) {
    const [x, y] = arrow;
    return event.shiftKey
      ? { kind: "truck", x, y }
      : { kind: "rotate", azimuth: x * KEYBOARD_ROTATE_STEP, polar: y * KEYBOARD_ROTATE_STEP };
  }
  if (event.key === "+" || event.key === "=") return { kind: "dolly", factor: KEYBOARD_DOLLY_FACTOR };
  if (event.key === "-" || event.key === "_") return { kind: "dolly", factor: -KEYBOARD_DOLLY_FACTOR };
  return null;
}
