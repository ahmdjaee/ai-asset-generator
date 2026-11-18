import { describe, expect, test } from "bun:test";
import { AUTH_REQUIRED_MESSAGE, isUsageLimitText, resultMeta, toAgentEvents } from "./events.ts";
import {
  assistantMessage,
  deltaMessage,
  initMessage,
  rateLimitMessage,
  resultMessage,
  text,
  thinking,
  toolResultMessage,
  toolUse,
} from "./fake-messages.ts";

describe("toAgentEvents", () => {
  test("init → session id dan model", () => {
    expect(toAgentEvents(initMessage("S1"))).toEqual([
      { type: "init", sessionId: "S1", model: "claude-opus-5-5" },
    ]);
  });

  test("assistant: ringkasan berpikir, teks, dan pemanggilan tool berurutan; blok kosong dibuang", () => {
    const message = assistantMessage("S1", [
      thinking("Kaki kursi terlalu tipis di sudut Kiri."),
      thinking("  "),
      text("Saya tebalkan kakinya."),
      toolUse("tu-1", "mcp__forge__build_base_mesh", { note: "kaki 4 cm" }),
    ]);
    expect(toAgentEvents(message)).toEqual([
      { type: "thinking", text: "Kaki kursi terlalu tipis di sudut Kiri." },
      { type: "assistant", text: "Saya tebalkan kakinya." },
      { type: "tool", toolUseId: "tu-1", name: "mcp__forge__build_base_mesh", input: { note: "kaki 4 cm" } },
    ]);
  });

  test("assistant ber-error authentication_failed → AUTH_REQUIRED; teks CLI berbahasa Inggris tidak tampil", () => {
    const message = assistantMessage("S1", [text("Not logged in · Please run /login")], {
      error: "authentication_failed",
    });
    expect(toAgentEvents(message)).toEqual([
      { type: "error", code: "AUTH_REQUIRED", message: AUTH_REQUIRED_MESSAGE },
    ]);
    // Error lain (mis. server_error) tetap memakai jalur biasa.
    const other = assistantMessage("S1", [text("API Error: 500")], { error: "server_error" });
    expect(toAgentEvents(other)).toEqual([{ type: "assistant", text: "API Error: 500" }]);
  });

  test("delta teks dan berpikir", () => {
    expect(toAgentEvents(deltaMessage("S1", "text", "Hal"))).toEqual([
      { type: "delta", kind: "text", text: "Hal" },
    ]);
    expect(toAgentEvents(deltaMessage("S1", "thinking", "Hm"))).toEqual([
      { type: "delta", kind: "thinking", text: "Hm" },
    ]);
  });

  test("hasil tool: pratinjau teks, gambar dihitung (base64 tidak ikut)", () => {
    const data = "A".repeat(5000);
    const [event] = toAgentEvents(
      toolResultMessage("S1", "tu-1", [
        { type: "text", text: '{"ok":true,"version":1}' },
        { type: "image", source: { type: "base64", media_type: "image/png", data } },
      ]),
    );
    expect(event).toEqual({
      type: "tool_result",
      toolUseId: "tu-1",
      isError: false,
      preview: '{"ok":true,"version":1}\n[gambar]',
      images: 1,
    });
  });

  test("hasil tool panjang dipotong", () => {
    const [event] = toAgentEvents(toolResultMessage("S1", "tu-1", "x".repeat(2000), true));
    expect(event).toMatchObject({ isError: true });
    expect(event?.type === "tool_result" ? event.preview.length : 0).toBe(601);
  });

  test("result → event result; resultMeta membawa uuid pesan", () => {
    const message = resultMessage("S1", ["u1"], { costUsd: 0.5 });
    expect(toAgentEvents(message)).toEqual([
      {
        type: "result",
        subtype: "success",
        isError: false,
        interrupted: false,
        durationMs: 10,
        numTurns: 1,
        costUsd: 0.5,
      },
    ]);
    expect(resultMeta(message)).toEqual({ sessionId: "S1", userMessageUuids: ["u1"] });
    expect(resultMeta(initMessage("S1"))).toBeUndefined();
  });

  test("batas pemakaian: rate_limit_event rejected → USAGE_LIMIT dengan waktu reset dalam ms", () => {
    expect(toAgentEvents(rateLimitMessage("S1", "allowed"))).toEqual([]);
    // SDK memberi detik epoch (header reset API); app memakai ms epoch.
    expect(toAgentEvents(rateLimitMessage("S1", "rejected", 1_800_000_000))).toEqual([
      {
        type: "error",
        code: "USAGE_LIMIT",
        message: "Batas pemakaian Claude tercapai.",
        resetsAt: 1_800_000_000_000,
      },
    ]);
    // Nilai yang sudah ms tidak dikali lagi.
    expect(toAgentEvents(rateLimitMessage("S1", "rejected", 1_800_000_000_000))).toMatchObject([
      { resetsAt: 1_800_000_000_000 },
    ]);
  });

  test("batas pemakaian: teks assistant berawalan USAGE_LIMIT_ERROR_PREFIXES → USAGE_LIMIT", () => {
    const limit = "You've hit your limit · resets 5pm";
    expect(isUsageLimitText(limit)).toBe(true);
    expect(isUsageLimitText("Saya sudah selesai.")).toBe(false);
    expect(toAgentEvents(assistantMessage("S1", [text(limit)]))).toEqual([
      { type: "error", code: "USAGE_LIMIT", message: limit },
    ]);
  });
});
