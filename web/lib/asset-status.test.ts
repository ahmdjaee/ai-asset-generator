import { describe, expect, test } from "bun:test";
import { assetBadge, stageProgress } from "./asset-status.ts";

describe("status aset untuk tampilan", () => {
  test("Badge: gagal dan Claude bekerja mendahului tahap", () => {
    expect(assetBadge({ status: "BASE_REVIEW", runState: "failed" })).toEqual({
      tone: "danger",
      label: "Gagal",
    });
    expect(assetBadge({ status: "BASE_WORKING", runState: "running" })).toEqual({
      tone: "accent",
      label: "Membuat…",
    });
    expect(assetBadge({ status: "BRIEFING", runState: "waiting_user" }).label).toBe("Membuat…");
    expect(assetBadge({ status: "DONE", runState: "idle" })).toEqual({ tone: "success", label: "Final" });
    expect(assetBadge({ status: "TEXTURE_REVIEW", runState: "idle" })).toEqual({
      tone: "warning",
      label: "Perlu review",
    });
    expect(assetBadge({ status: "BASE_WORKING", runState: "interrupted" })).toEqual({
      tone: "neutral",
      label: "Bentuk dasar",
    });
    expect(assetBadge({ status: "TEXTURE_WORKING", runState: "idle" })).toEqual({
      tone: "neutral",
      label: "Aset final",
    });
  });

  test("indikator tahap dari status", () => {
    expect(stageProgress("BRIEFING")).toBe("base");
    expect(stageProgress("BASE_REVIEW")).toBe("base");
    expect(stageProgress("TEXTURE_WORKING")).toBe("final");
    expect(stageProgress("TEXTURE_REVIEW")).toBe("final");
    expect(stageProgress("DONE")).toBe("done");
  });
});
