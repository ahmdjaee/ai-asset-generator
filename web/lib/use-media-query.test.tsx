import { afterEach, describe, expect, test } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import { REDUCED_MOTION_QUERY, useReducedMotion } from "./use-media-query.ts";

/** MediaQueryList palsu yang bisa diubah dari tes, seperti pengguna mengubah pengaturan sistem. */
class FakeMediaQueryList extends EventTarget implements MediaQueryList {
  readonly media: string;
  onchange: MediaQueryList["onchange"] = null;
  private readonly state: { matches: boolean; listeners: number };

  constructor(media: string, state: { matches: boolean; listeners: number }) {
    super();
    this.media = media;
    this.state = state;
  }

  get matches(): boolean {
    return this.media === REDUCED_MOTION_QUERY && this.state.matches;
  }

  override addEventListener(...args: Parameters<EventTarget["addEventListener"]>): void {
    this.state.listeners += 1;
    super.addEventListener(...args);
  }

  override removeEventListener(...args: Parameters<EventTarget["removeEventListener"]>): void {
    this.state.listeners -= 1;
    super.removeEventListener(...args);
  }

  addListener(): void {}
  removeListener(): void {}
}

function fakeMedia(initial: boolean) {
  const state = { matches: initial, listeners: 0 };
  const lists: FakeMediaQueryList[] = [];
  const original = window.matchMedia;
  window.matchMedia = (query: string) => {
    const list = new FakeMediaQueryList(query, state);
    lists.push(list);
    return list;
  };
  return {
    set(next: boolean) {
      state.matches = next;
      for (const list of lists) list.dispatchEvent(new Event("change"));
    },
    listenerCount: () => state.listeners,
    restore() {
      window.matchMedia = original;
    },
  };
}

function Probe() {
  return <p>{useReducedMotion() ? "kurangi" : "normal"}</p>;
}

let media: ReturnType<typeof fakeMedia> | null = null;
afterEach(() => {
  media?.restore();
  media = null;
});

describe("useReducedMotion", () => {
  test("membaca pengaturan sistem dan ikut berubah tanpa memuat ulang", () => {
    media = fakeMedia(false);
    const view = render(<Probe />);
    expect(screen.getByText("normal")).toBeDefined();
    act(() => media?.set(true));
    expect(screen.getByText("kurangi")).toBeDefined();
    view.unmount();
    expect(media.listenerCount()).toBe(0);
  });

  test("render ulang tidak menambah langganan", () => {
    media = fakeMedia(true);
    const view = render(<Probe />);
    view.rerender(<Probe />);
    view.rerender(<Probe />);
    expect(media.listenerCount()).toBe(1);
    expect(screen.getByText("kurangi")).toBeDefined();
  });
});
