import { afterEach, describe, expect, test } from "bun:test";
import { isTypingTarget } from "@/lib/keyboard.ts";
import { KEYBOARD_DOLLY_FACTOR, KEYBOARD_ROTATE_STEP } from "./math.ts";
import { shortcutAction, viewportKeyAction } from "./shortcuts.ts";

/** Elemen uji yang ditempel ke body; dibuang setelah tiap tes supaya tidak terbaca tes lain (mis. tombol bernama sama). */
const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

function keyEvent(key: string, init: Partial<KeyboardEventInit> = {}, target: EventTarget = document.body) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

function element(html: string, selector: string): Element {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  hosts.push(host);
  const found = host.querySelector(selector);
  if (!found) throw new Error(`elemen ${selector} tidak ada`);
  return found;
}

describe("pintasan viewer", () => {
  test.each([
    ["r", "spin"],
    ["R", "spin"],
    ["f", "focus"],
    ["w", "wireframe"],
    ["g", "grid"],
    ["l", "light"],
  ] as const)("%s → %s", (key, action) => {
    expect(shortcutAction(keyEvent(key))).toBe(action);
  });

  test("huruf lain, modifier, tahan tombol, dan event yang sudah ditangani diabaikan", () => {
    expect(shortcutAction(keyEvent("x"))).toBeNull();
    expect(shortcutAction(keyEvent("r", { ctrlKey: true }))).toBeNull();
    expect(shortcutAction(keyEvent("r", { metaKey: true }))).toBeNull();
    expect(shortcutAction(keyEvent("r", { altKey: true }))).toBeNull();
    expect(shortcutAction(keyEvent("r", { repeat: true }))).toBeNull();
    const handled = keyEvent("r");
    handled.preventDefault();
    expect(shortcutAction(handled)).toBeNull();
  });

  test.each([
    ['<textarea aria-label="Pesan"></textarea>', "textarea"],
    ['<input aria-label="Cari">', "input"],
    ['<div contenteditable="true"><p>teks</p></div>', "p"],
    ['<div role="menu"><div role="menuitemradio">Depan</div></div>', '[role="menuitemradio"]'],
    ['<div role="dialog"><button type="button">Tutup</button></div>', "button"],
  ])("tidak aktif saat fokus di %s", (html, selector) => {
    const target = element(html, selector);
    expect(isTypingTarget(target)).toBe(true);
    expect(shortcutAction(keyEvent("w", {}, target))).toBeNull();
  });

  test("aktif saat fokus di tombol toolbar", () => {
    const button = element('<button type="button">Wireframe</button>', "button");
    expect(shortcutAction(keyEvent("w", {}, button))).toBe("wireframe");
  });
});

describe("tombol kanvas", () => {
  test.each([
    ["ArrowLeft", { kind: "rotate", azimuth: KEYBOARD_ROTATE_STEP, polar: 0 }],
    ["ArrowRight", { kind: "rotate", azimuth: -KEYBOARD_ROTATE_STEP, polar: 0 }],
    ["ArrowUp", { kind: "rotate", azimuth: 0, polar: KEYBOARD_ROTATE_STEP }],
    ["ArrowDown", { kind: "rotate", azimuth: 0, polar: -KEYBOARD_ROTATE_STEP }],
    ["+", { kind: "dolly", factor: KEYBOARD_DOLLY_FACTOR }],
    ["=", { kind: "dolly", factor: KEYBOARD_DOLLY_FACTOR }],
    ["-", { kind: "dolly", factor: -KEYBOARD_DOLLY_FACTOR }],
    ["_", { kind: "dolly", factor: -KEYBOARD_DOLLY_FACTOR }],
  ] as const)("%s → %o", (key, action) => {
    expect(viewportKeyAction(keyEvent(key))).toEqual(action);
  });

  test("Shift + panah menggeser ke arah panah, sama dengan Shift + seret", () => {
    expect(viewportKeyAction(keyEvent("ArrowLeft", { shiftKey: true }))).toEqual({
      kind: "truck",
      x: 1,
      y: 0,
    });
    expect(viewportKeyAction(keyEvent("ArrowRight", { shiftKey: true }))).toEqual({
      kind: "truck",
      x: -1,
      y: 0,
    });
    expect(viewportKeyAction(keyEvent("ArrowUp", { shiftKey: true }))).toEqual({ kind: "truck", x: 0, y: 1 });
    expect(viewportKeyAction(keyEvent("ArrowDown", { shiftKey: true }))).toEqual({
      kind: "truck",
      x: 0,
      y: -1,
    });
  });

  test("Shift tetap boleh untuk zoom: + di keyboard US butuh Shift", () => {
    expect(viewportKeyAction(keyEvent("+", { shiftKey: true }))).toEqual({
      kind: "dolly",
      factor: KEYBOARD_DOLLY_FACTOR,
    });
  });

  test.each([
    ["-", { ctrlKey: true }],
    ["=", { ctrlKey: true }],
    ["+", { metaKey: true }],
    ["ArrowLeft", { altKey: true }],
    ["ArrowRight", { metaKey: true }],
  ] as const)("%s dengan %o milik browser (zoom halaman, kembali): tidak ditangkap", (key, init) => {
    expect(viewportKeyAction(keyEvent(key, init))).toBeNull();
  });

  test("tombol lain diabaikan", () => {
    expect(viewportKeyAction(keyEvent("Enter"))).toBeNull();
    expect(viewportKeyAction(keyEvent("w"))).toBeNull();
  });
});
