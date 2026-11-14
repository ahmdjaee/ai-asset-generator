import { describe, expect, mock, test } from "bun:test";
import { render } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { hold, holdCached } from "./lifetime.ts";

/** Menunggu microtask yang sudah antre (pembuangan tertunda). */
const flush = () => Promise.resolve();

function Holder({ value, dispose }: { value: object; dispose: () => void }) {
  useEffect(() => hold(value, dispose), [value, dispose]);
  return null;
}

describe("hold", () => {
  test("dibuang sekali setelah pemakai terakhir lepas", async () => {
    const value = {};
    const dispose = mock(() => undefined);
    const first = hold(value, dispose);
    const second = hold(value, dispose);
    first();
    await flush();
    expect(dispose).not.toHaveBeenCalled();
    second();
    second();
    expect(dispose).not.toHaveBeenCalled();
    await flush();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  test("lepas lalu dipegang lagi di tick yang sama (StrictMode): tidak dibuang", async () => {
    const value = {};
    const dispose = mock(() => undefined);
    hold(value, dispose)();
    const again = hold(value, dispose);
    await flush();
    expect(dispose).not.toHaveBeenCalled();
    again();
    await flush();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  test("lepas → pegang → lepas dalam satu tick: dibuang tepat sekali", async () => {
    const value = {};
    const dispose = mock(() => undefined);
    hold(value, dispose)();
    hold(value, dispose)();
    await flush();
    await flush();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  test("di dalam effect StrictMode: tetap hidup selama terpasang, dibuang saat dilepas", async () => {
    const value = {};
    const dispose = mock(() => undefined);
    const view = render(
      <StrictMode>
        <Holder value={value} dispose={dispose} />
      </StrictMode>,
    );
    await flush();
    expect(dispose).not.toHaveBeenCalled();
    view.unmount();
    await flush();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

describe("holdCached", () => {
  test("mengosongkan cache kunci itu saat isinya dibuang", async () => {
    const value = {};
    const dispose = mock(() => undefined);
    const evict = mock((_key: string) => undefined);
    holdCached("/a.glb", value, dispose, evict)();
    await flush();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(evict).toHaveBeenCalledWith("/a.glb");
  });

  test("cache tidak dikosongkan bila kunci yang sama sudah berisi muatan baru", async () => {
    const old = {};
    const fresh = {};
    const evict = mock((_key: string) => undefined);
    const disposeOld = mock(() => undefined);
    const releaseOld = holdCached("/b.glb", old, disposeOld, evict);
    const releaseFresh = holdCached("/b.glb", fresh, () => undefined, evict);
    releaseOld();
    await flush();
    expect(disposeOld).toHaveBeenCalledTimes(1);
    expect(evict).not.toHaveBeenCalled();
    releaseFresh();
    await flush();
    expect(evict).toHaveBeenCalledTimes(1);
  });
});
