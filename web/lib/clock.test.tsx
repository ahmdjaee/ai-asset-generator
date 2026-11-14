import { describe, expect, test } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import { FakeClock } from "@/test-clock.ts";
import { ClockProvider, useNow } from "./clock.tsx";

function Elapsed({ live }: { live: boolean }) {
  return <p>{useNow(live)}</p>;
}

describe("useNow", () => {
  test("diperbarui tiap detik selama live; berhenti dan melepas timer saat tidak live", () => {
    const clock = new FakeClock(10_000);
    const view = render(
      <ClockProvider clock={clock}>
        <Elapsed live />
      </ClockProvider>,
    );
    expect(screen.getByText("10000")).toBeDefined();
    act(() => clock.advance(2_500));
    expect(screen.getByText("12000")).toBeDefined();
    expect(clock.pending).toBe(1);
    view.rerender(
      <ClockProvider clock={clock}>
        <Elapsed live={false} />
      </ClockProvider>,
    );
    expect(clock.pending).toBe(0);
    expect(screen.getByText("12500")).toBeDefined();
  });

  test("jam palsu: timer sekali jalan dipanggil sekali saat jatuh tempo, urut waktunya; pembatal mencegahnya", () => {
    const clock = new FakeClock(0);
    const calls: string[] = [];
    clock.after(300, () => calls.push(`b@${clock.now()}`));
    clock.after(100, () => calls.push(`a@${clock.now()}`));
    const cancel = clock.after(200, () => calls.push("batal"));
    cancel();
    clock.advance(1_000);
    expect(calls).toEqual(["a@100", "b@300"]);
    expect(clock.pending).toBe(0);
  });
});
