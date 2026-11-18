import { describe, expect, mock, spyOn, test } from "bun:test";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { useState } from "react";
import { t } from "@/i18n/id.ts";
import { ClockProvider } from "@/lib/clock.tsx";
import { T0 } from "@/test-assets.ts";
import { FakeClock } from "@/test-clock.ts";
import { renderUi } from "@/test-utils.tsx";
import type { AskQuestion } from "../../../shared/agent-events.ts";
import { formatTime } from "../../../shared/format.ts";
import type { AnswerPayload } from "./queries.ts";
import { type ThreadContext, ThreadView, type ThreadViewProps } from "./ThreadView.tsx";
import type { ClaudeBlock, ThreadItem } from "./thread-items.ts";

function context(patch: Partial<ThreadContext> = {}): ThreadContext {
  return {
    attachmentUrl: (id) => `/api/assets/peti/attachments/${id}`,
    builds: {},
    timings: () => null,
    nextVersion: null,
    questionOpen: false,
    onAnswer: async () => undefined,
    ...patch,
  };
}

function renderThread(props: Partial<ThreadViewProps>) {
  return renderUi(
    <ClockProvider clock={new FakeClock(T0)}>
      <ThreadView
        items={[]}
        phase="ready"
        hasMore={false}
        loadingOlder={false}
        onLoadOlder={() => undefined}
        onRetry={() => undefined}
        context={context()}
        {...props}
      />
    </ClockProvider>,
  );
}

const claude = (key: string, blocks: readonly ClaudeBlock[], header = true): ThreadItem => ({
  kind: "claude",
  key,
  header,
  blocks,
});

const QUESTION: AskQuestion = {
  question: "Gaya pegangan?",
  header: "Pegangan",
  multiSelect: false,
  options: [
    { label: "Besi melengkung", description: "" },
    { label: "Tali kulit", description: "" },
  ],
};

const userItem = (key: string): ThreadItem => ({ kind: "user", key, text: `Pesan ${key}`, attachments: [] });

/** Thread yang memuat halaman lama seperti `ThreadStore`: `loadingOlder` aktif sampai tes memanggil `finish`. */
function OlderHarness({ onLoad }: { onLoad: (finish: (older: readonly ThreadItem[]) => void) => void }) {
  const [items, setItems] = useState<readonly ThreadItem[]>(() =>
    ["n1", "n2", "n3", "n4", "n5", "n6"].map(userItem),
  );
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  return (
    <ThreadView
      items={items}
      phase="ready"
      hasMore={hasMore}
      loadingOlder={loadingOlder}
      onLoadOlder={() => {
        setLoadingOlder(true);
        onLoad((older) => {
          setItems((current) => [...older, ...current]);
          setLoadingOlder(false);
          setHasMore(false);
        });
      }}
      onRetry={() => undefined}
      context={context()}
    />
  );
}

/**
 * Tata letak tiruan (happy-dom tidak menghitung layout): setiap anak daftar thread setinggi 100 px berurutan dari atas,
 * area gulir 200 px dengan `scrollTop` yang bisa diubah.
 */
function simulateLayout(scroller: HTMLElement) {
  const list = scroller.firstElementChild;
  if (list === null) throw new Error("daftar thread tidak ditemukan");
  let scrollTop = 0;
  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  Object.defineProperty(scroller, "scrollHeight", {
    configurable: true,
    get: () => list.children.length * 100,
  });
  Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => 200 });
  const rect = spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const top = this === scroller ? 0 : Array.from(list.children).indexOf(this) * 100 - scrollTop;
    return new DOMRect(0, top, 360, 100);
  });
  return { scrollTo: (value: number) => (scroller.scrollTop = value), restore: () => rect.mockRestore() };
}

describe("ThreadView", () => {
  test("muat pesan sebelumnya: posisi baca dijaga setelah halaman lama tiba (bukan saat mulai memuat)", async () => {
    const finishers: Array<(older: readonly ThreadItem[]) => void> = [];
    const { user, container } = renderUi(
      <ClockProvider clock={new FakeClock(T0)}>
        <OlderHarness onLoad={(finish) => finishers.push(finish)} />
      </ClockProvider>,
    );
    const scroller = container.firstElementChild;
    if (!(scroller instanceof HTMLElement)) throw new Error("area gulir thread tidak ditemukan");
    const layout = simulateLayout(scroller);
    try {
      // Pemilik membaca di tengah (tidak di dasar): pesan n1 berada 200 px di atas area terlihat.
      layout.scrollTo(300);
      fireEvent.scroll(scroller);
      await user.click(screen.getByRole("button", { name: t.thread.loadOlder }));
      expect(scroller.scrollTop).toBe(300);
      act(() => finishers[0]?.(["o1", "o2", "o3", "o4"].map(userItem)));
      // Empat pesan lama (400 px) masuk di atas, tombol hilang (−100 px): n1 tetap 200 px di atas area terlihat.
      expect(scroller.scrollTop).toBe(600);
      expect(screen.getByText("Pesan n1").closest("article")?.getBoundingClientRect().top).toBe(-200);
    } finally {
      layout.restore();
    }
  });

  test("pesan pemilik dengan lampiran, aksi pemilik, dan grup Claude dengan blok-bloknya", async () => {
    const { user } = renderThread({
      items: [
        {
          kind: "user",
          key: "u1",
          text: "Peti harta kayu",
          attachments: [
            { id: "a1", kind: "image", name: "sketsa.png" },
            { id: "a2", kind: "model", name: "kursi.glb" },
          ],
        },
        claude("c1", [
          { kind: "thinking", key: "th1", text: "Mulai dari kotak dasar.", durationMs: 12_000, live: false },
          {
            kind: "brief",
            key: "b1",
            brief: {
              summary: "Peti harta kayu",
              category: "Properti",
              style: "Stylized",
              dimensionsM: { width: 0.65, depth: 0.44, height: 0.53 },
              notes: "Engsel besi di belakang",
            },
          },
          { kind: "text", key: "t1", text: "Saya buat **bentuk dasar** dulu.", live: false },
          { kind: "notice", key: "n1", text: "Batas build pesan ini tercapai." },
        ]),
        { kind: "action", key: "x1", action: "approve", version: 1 },
        claude("c2", [{ kind: "stopped", key: "s1" }]),
      ],
    });

    const owner = screen.getByRole("article", { name: t.thread.owner });
    expect(within(owner).getByText("Peti harta kayu")).toBeDefined();
    const attachments = within(owner).getByRole("list", { name: t.thread.attachments });
    expect(
      within(attachments)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["sketsa.png", "kursi.glb"]);

    const [first, second] = screen.getAllByRole("article", { name: t.thread.claude });
    if (first === undefined || second === undefined) throw new Error("dua grup Claude");
    const thinking = within(first).getByRole("button", { name: t.thread.thinking.done("12 dtk") });
    expect(thinking.getAttribute("aria-expanded")).toBe("false");
    expect(within(first).getByText("Mulai dari kotak dasar.").hidden).toBe(true);
    await user.click(thinking);
    expect(thinking.getAttribute("aria-expanded")).toBe("true");
    expect(within(first).getByText("Mulai dari kotak dasar.").hidden).toBe(false);

    const brief = within(first).getByRole("region", { name: t.thread.brief.title });
    expect(within(brief).getByText("Properti · Stylized")).toBeDefined();
    expect(within(brief).getByText(t.thread.brief.sizeValue("65", "44", "53"))).toBeDefined();
    expect(within(brief).getByText("Engsel besi di belakang")).toBeDefined();
    expect(within(first).getByText("bentuk dasar").tagName).not.toBe("P");
    expect(within(first).getByText("Batas build pesan ini tercapai.")).toBeDefined();

    expect(screen.getByText(t.thread.actions.approve("v1"))).toBeDefined();
    expect(within(second).getByText(t.thread.stopped)).toBeDefined();
  });

  test("berpikir yang masih berjalan; build yang berjalan menjadi kartu progres", () => {
    renderThread({
      items: [
        claude("c1", [
          { kind: "thinking", key: "th1", text: "", durationMs: null, live: true },
          {
            kind: "build",
            key: "build:j1",
            jobId: "j1",
            stage: "base",
            status: "running",
            version: null,
            code: null,
            startedAt: T0 - 5_000,
            endedAt: null,
            scriptStartedAt: T0 - 9_000,
          },
        ]),
      ],
      context: context({ nextVersion: 2 }),
    });
    expect(screen.getByRole("button", { name: t.thread.thinking.live })).toBeDefined();
    expect(screen.getByText(t.build.running(t.build.stage.base, "v2"))).toBeDefined();
  });

  test("blok error: batas pemakaian dengan jam reset, aksi ditolak, proses berhenti, dan belum login", () => {
    const resetsAt = T0 + 3_600_000;
    renderThread({
      items: [
        claude("c1", [
          { kind: "error", key: "e1", code: "USAGE_LIMIT", message: "limit", resetsAt },
          { kind: "error", key: "e2", code: "USAGE_LIMIT", message: "limit", resetsAt: null },
          { kind: "error", key: "e3", code: "TOOL_DENIED", message: "denied", resetsAt: null },
          { kind: "error", key: "e4", code: "TURN_FAILED", message: "crash", resetsAt: null },
          { kind: "error", key: "e5", code: "AUTH_REQUIRED", message: "login", resetsAt: null },
        ]),
      ],
    });
    const { errors } = t.thread;
    expect(screen.getAllByText(errors.usageLimit.title)).toHaveLength(2);
    expect(screen.getByText(errors.usageLimit.resetsAt(formatTime(resetsAt)))).toBeDefined();
    expect(screen.getByText(errors.usageLimit.unknownReset)).toBeDefined();
    expect(screen.getByText(errors.denied.title)).toBeDefined();
    expect(screen.getByText(errors.failed.title)).toBeDefined();
    // Belum login (Tahap 11): petunjuk login, lalu kirim pesan untuk melanjutkan.
    expect(screen.getByText(errors.authRequired.title)).toBeDefined();
    expect(screen.getByText(errors.authRequired.description)).toBeDefined();
    // Pesan mentah dari SDK tidak ditampilkan.
    expect(screen.queryByText("crash")).toBeNull();
  });

  test("hanya pertanyaan terakhir yang belum terjawab yang bisa dijawab saat Claude menunggu", async () => {
    const onAnswer = mock(async (_questionId: string, _answers: AnswerPayload) => undefined);
    const { user } = renderThread({
      items: [
        claude("c1", [
          { kind: "question", key: "q1", questionId: "q1", questions: [QUESTION], resolution: null },
        ]),
        { kind: "user", key: "u1", text: "Lanjut saja", attachments: [] },
        claude("c2", [
          { kind: "question", key: "q2", questionId: "q2", questions: [QUESTION], resolution: null },
        ]),
      ],
      context: context({ questionOpen: true, onAnswer }),
    });
    const [stale, open] = screen.getAllByRole("region", { name: QUESTION.question });
    if (stale === undefined || open === undefined) throw new Error("dua kartu pertanyaan");
    // Kartu lama tanpa resolusi terkunci (resolusinya selalu menyusul lewat event); bukan "Tidak dijawab".
    expect(within(stale).queryByText(t.question.cancelled)).toBeNull();
    expect(within(stale).getByRole("group", { name: QUESTION.question }).hasAttribute("disabled")).toBe(true);
    expect(within(stale).getByRole("button", { name: t.question.submit }).hasAttribute("disabled")).toBe(
      true,
    );
    await user.click(within(open).getByRole("radio", { name: "Tali kulit" }));
    await user.click(within(open).getByRole("button", { name: t.question.submit }));
    expect(onAnswer).toHaveBeenCalledWith("q2", { [QUESTION.question]: { selected: ["Tali kulit"] } });
  });

  test("memuat, gagal dimuat (Coba lagi), dan tombol memuat pesan sebelumnya", async () => {
    const { unmount } = renderThread({ phase: "loading" });
    expect(screen.getByText(t.thread.loading)).toBeDefined();
    unmount();

    const onRetry = mock(() => undefined);
    const failed = renderThread({ phase: "error", onRetry });
    expect(screen.getByText(t.thread.error)).toBeDefined();
    expect(screen.queryByRole("button", { name: t.thread.loadOlder })).toBeNull();
    await failed.user.click(screen.getByRole("button", { name: t.thread.retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    failed.unmount();

    const onLoadOlder = mock(() => undefined);
    const ready = renderThread({ hasMore: true, onLoadOlder });
    await ready.user.click(screen.getByRole("button", { name: t.thread.loadOlder }));
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
    ready.unmount();

    renderThread({ hasMore: true, loadingOlder: true });
    expect(screen.getByRole("button", { name: t.thread.loadOlder }).getAttribute("aria-busy")).toBe("true");
  });
});
