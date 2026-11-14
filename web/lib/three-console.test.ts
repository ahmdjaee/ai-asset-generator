import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { warn } from "three";
import { installThreeConsoleFilter, KNOWN_UPSTREAM_WARNINGS } from "./three-console.ts";

describe("installThreeConsoleFilter", () => {
  const consoleWarn = spyOn(console, "warn").mockImplementation(() => undefined);

  afterEach(() => {
    consoleWarn.mockClear();
  });

  test("hanya peringatan upstream yang tercatat yang disaring", () => {
    installThreeConsoleFilter();
    warn("Clock: This module has been deprecated. Please use THREE.Timer instead.");
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(KNOWN_UPSTREAM_WARNINGS.size).toBe(1);
  });

  test("peringatan three.js lain tetap muncul di console", () => {
    installThreeConsoleFilter();
    warn("WebGLRenderer: contoh peringatan lain.");
    expect(consoleWarn).toHaveBeenCalledWith("THREE.WebGLRenderer: contoh peringatan lain.");
  });
});
