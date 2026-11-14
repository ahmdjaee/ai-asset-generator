import { describe, expect, test } from "bun:test";
import { trimStream } from "./sdk-fixture.ts";

const delta = (kind: string) =>
  JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: kind } } });

describe("trimStream", () => {
  test("delta dipangkas per jenis, pesan penting tetap, pesan bising maks 2", () => {
    const lines = [
      JSON.stringify({ type: "system", subtype: "init", cwd: "/x" }),
      ...Array.from({ length: 9 }, () => delta("text_delta")),
      ...Array.from({ length: 3 }, () => delta("thinking_delta")),
      ...Array.from({ length: 4 }, () => JSON.stringify({ type: "system", subtype: "thinking_tokens" })),
      JSON.stringify({ type: "result", subtype: "success" }),
      "",
    ];
    const kept = trimStream(lines);
    expect(kept).toHaveLength(1 + 5 + 3 + 2 + 1);
    expect(kept.at(-1)).toEqual({ type: "result", subtype: "success" });
  });

  test("email disanitasi", () => {
    expect(trimStream([JSON.stringify({ type: "assistant", text: "a@b.co" })])).toEqual([
      { type: "assistant", text: "pemilik@contoh.invalid" },
    ]);
  });
});
