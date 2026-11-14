import { describe, expect, test } from "bun:test";
import { cn } from "./utils.ts";

describe("cn", () => {
  test("text style dan warna teks tidak saling menghapus", () => {
    expect(cn("text-body", "text-text-primary")).toBe("text-body text-text-primary");
    expect(cn("text-caption-strong", "text-accent-text")).toBe("text-caption-strong text-accent-text");
  });

  test("dua text style: yang terakhir menang", () => {
    expect(cn("text-body", "text-label")).toBe("text-label");
    expect(cn("text-body-strong", "text-overline")).toBe("text-overline");
  });

  test("dua warna dari token: yang terakhir menang", () => {
    expect(cn("bg-bg-app", "bg-bg-panel")).toBe("bg-bg-panel");
    expect(cn("text-text-primary", "text-danger-text")).toBe("text-danger-text");
  });

  test("radius dan spasi FigCraft", () => {
    expect(cn("rounded-lg", "rounded-md")).toBe("rounded-md");
    expect(cn("px-3.5", "px-6")).toBe("px-6");
  });

  test("nilai kosong diabaikan", () => {
    expect(cn("h-9", false, undefined, null, "", "h-7.5")).toBe("h-7.5");
  });
});
