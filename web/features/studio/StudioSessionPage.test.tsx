import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useImperativeHandle } from "react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { Toaster } from "@/components/ui/toast.tsx";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import { t } from "@/i18n/id.ts";
import { arrivalState } from "@/lib/arrival-focus.ts";
import { useAssets } from "@/lib/assets.ts";
import { ClockProvider } from "@/lib/clock.tsx";
import { RealtimeProvider } from "@/lib/realtime-context.tsx";
import { assetFixture, detailFixture, listFixture, T0, versionFixture } from "@/test-assets.ts";
import { FakeClock } from "@/test-clock.ts";
import { FakeRealtime } from "@/test-realtime.ts";
import { FakeServer } from "@/test-server.ts";
import { jsonResponse, mockFetch, renderWithQuery } from "@/test-utils.tsx";
import type { AssetEvent, StoredEvent } from "../../../shared/asset-events.ts";
import { DetailPanel } from "../viewer/DetailPanel.tsx";
import type { ViewerProps } from "../viewer/Viewer.tsx";
import type { AssetDetailData } from "./queries.ts";
import { StudioSessionPage } from "./StudioSessionPage.tsx";
import { SessionViewerContext } from "./session-viewer.tsx";

const TOPIC = "asset:peti";

let server: FakeServer;
let realtime: FakeRealtime;
let restoreFetch: () => void = () => undefined;
let seq = 0;

function stored(event: AssetEvent, ts = T0): StoredEvent {
  seq += 1;
  return { assetId: "peti", seq, ts, event };
}

/** Percakapan sampai bentuk dasar v1 dikirim untuk review. */
function reviewThread(): StoredEvent[] {
  return [
    stored({ type: "user", uuid: "u1", text: "Peti harta kayu dengan engsel besi" }),
    stored({ type: "assistant", text: "Saya buat bentuk dasarnya dulu." }),
    stored({ type: "build_started", jobId: "j1", stage: "base", buildNumber: 1 }),
    stored({ type: "build_finished", jobId: "j1", ok: true, version: 1 }),
    stored({ type: "submitted", version: 1, summary: "Bentuk dasar siap.", stage: "base" }),
    stored({
      type: "result",
      subtype: "success",
      isError: false,
      interrupted: false,
      durationMs: 1_000,
      numTurns: 3,
    }),
  ];
}

function serve(detail: AssetDetailData, events: readonly StoredEvent[]): void {
  server.on("GET", "/api/assets", listFixture([]));
  server.on("GET", "/api/assets/peti", detail);
  server.on("GET", "/api/assets/peti/events", { events, hasMore: false });
}

/**
 * Pengamat daftar aset (seperti rel dan kartu "Terakhir dibuat" di app). Aksi yang berhasil menginvalidasi daftar,
 * jadi permintaan `GET /api/assets` berikutnya menandai `onSuccess` aksi sudah berjalan.
 */
function AssetListProbe() {
  useAssets();
  return null;
}

beforeEach(() => {
  seq = 0;
  server = new FakeServer();
  realtime = new FakeRealtime();
  const spy = mockFetch(server.fetch);
  restoreFetch = () => spy.mockRestore();
});

afterEach(() => {
  restoreFetch();
});

function HomeStub() {
  return <p>Studio baru</p>;
}

/** PNG 1×1 untuk tangkapan viewport tiruan. */
const CAPTURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Viewer tiruan (tanpa three.js): menampilkan file yang dibuka dan panel Detail sungguhan, dan `captureView` memberi
 * PNG kecil dalam mode bawaan tahapnya.
 */
function FakeViewer({ src, name, stage = "base", detail, ref }: ViewerProps) {
  useImperativeHandle(
    ref,
    () => ({
      captureView: async () => ({
        blob: new Blob([CAPTURE], { type: "image/png" }),
        mode: stage === "final" ? ("texture" as const) : ("clay" as const),
      }),
    }),
    [stage],
  );
  return (
    <section aria-label={t.viewer.region}>
      <p>{`${name} · ${stage} · ${src}`}</p>
      {detail === undefined ? null : <DetailPanel data={detail} onCollapse={() => undefined} />}
    </section>
  );
}

/** Viewer tiruan yang gagal mengambil tangkapan (mis. konteks WebGL hilang saat `gl.render`). */
function BrokenCaptureViewer(props: ViewerProps) {
  useImperativeHandle(
    props.ref,
    () => ({
      captureView: async () => {
        throw new Error("konteks WebGL hilang");
      },
    }),
    [],
  );
  return <FakeViewer {...props} ref={undefined} />;
}

async function renderSession(viewer: (props: ViewerProps) => ReactNode = FakeViewer) {
  const router = createMemoryRouter(
    [
      { path: "/", Component: HomeStub },
      { path: "/studio/:assetId", Component: StudioSessionPage },
    ],
    { initialEntries: ["/studio/peti"] },
  );
  renderWithQuery(
    <ClockProvider clock={new FakeClock(T0)}>
      <RealtimeProvider client={realtime}>
        <SessionViewerContext value={viewer}>
          <TooltipProvider>
            {/* Seperti AppLayout: halaman berada di dalam `<main>` yang bisa difokus. */}
            <main tabIndex={-1}>
              <RouterProvider router={router} />
            </main>
            <AssetListProbe />
            <Toaster />
          </TooltipProvider>
        </SessionViewerContext>
      </RealtimeProvider>
    </ClockProvider>,
  );
  const user = userEvent.setup();
  // Server memasang langganan topik aset: jendela event diambil.
  expect(realtime.topics()).toContain(TOPIC);
  realtime.ready(TOPIC);
  // Detail dan jendela event dimuat async. Ditunggu di dalam `waitFor` (tanpa lingkungan act), supaya render ulang dari
  // pemuatan itu tidak tercampur dengan langkah tes berikutnya.
  await waitFor(() => {
    expect(screen.queryByText(t.loading)).toBeNull();
    expect(screen.queryByText(t.thread.loading)).toBeNull();
  });
  return { router, user };
}

const thread = () => screen.getByRole("region", { name: t.thread.label });
const composer = () => screen.getByRole<HTMLTextAreaElement>("textbox", { name: t.composer.label });

describe("Studio · sesi", () => {
  test("review bentuk dasar: topbar, thread, kartu persetujuan; Setujui mengirim approve dan dock berganti", async () => {
    serve(detailFixture(), reviewThread());
    server.on("POST", "/api/assets/peti/approve", {
      asset: assetFixture({ status: "TEXTURE_WORKING", runState: "running", approvedBaseVersion: 1 }),
    });
    const { user } = await renderSession();

    expect(await screen.findByRole("heading", { level: 1, name: "Peti harta kayu" })).toBeDefined();
    const breadcrumb = screen.getByRole("navigation", { name: t.shell.breadcrumb });
    expect(within(breadcrumb).getByText("Peti harta kayu").getAttribute("aria-current")).toBe("page");
    // Tier di topbar layar 02 (#999) memakai `icon/color` = `text/tertiary`, bukan warna teks induk.
    const topbar = breadcrumb.closest("header");
    if (topbar === null) throw new Error("topbar tidak ditemukan");
    expect(within(topbar).getByText(t.tier.sedang).className).toContain("text-text-tertiary");
    expect(screen.getByText(t.status.review)).toBeDefined();
    const download = screen.getByRole("link", { name: t.session.download });
    expect(download.getAttribute("href")).toBe("/api/assets/peti/versions/1/web.glb");
    expect(download.getAttribute("download")).toBe("peti-harta-kayu-v1.glb");

    expect(await within(thread()).findByText("Peti harta kayu dengan engsel besi")).toBeDefined();
    expect(within(thread()).getByText("Saya buat bentuk dasarnya dulu.")).toBeDefined();

    expect(screen.getByRole("heading", { name: t.dock.baseReview.title("v1") })).toBeDefined();
    await user.click(screen.getByRole("button", { name: t.dock.baseReview.approve }));
    expect(server.calls("POST", "/api/assets/peti/approve")).toHaveLength(1);
    expect(await screen.findByRole("heading", { name: t.dock.working.title })).toBeDefined();
    expect(screen.getByText(t.status.working)).toBeDefined();
  });

  test("Minta revisi memfokuskan composer; Enter mengirim pesan sebagai form", async () => {
    serve(detailFixture(), reviewThread());
    let text: FormDataEntryValue | null = null;
    server.on("POST", "/api/assets/peti/messages", async (request) => {
      text = (await request.formData()).get("text");
      return jsonResponse({ asset: assetFixture({ status: "BASE_WORKING", runState: "running" }) });
    });
    const { user } = await renderSession();
    await user.click(await screen.findByRole("button", { name: t.dock.revise }));
    expect(document.activeElement).toBe(composer());
    await user.type(composer(), "Tutupnya lebih melengkung{Enter}");
    await waitFor(() => expect(text).toBe("Tutupnya lebih melengkung"));
    await waitFor(() => expect(composer().value).toBe(""));
    expect(await screen.findByRole("heading", { name: t.dock.working.title })).toBeDefined();
  });

  test("Claude bertanya: composer nonaktif, jawaban terpilih dikirim ke rute jawaban", async () => {
    serve(
      detailFixture({
        asset: assetFixture({ status: "BRIEFING", runState: "waiting_user", currentVersion: null }),
        versions: [],
      }),
      [
        stored({ type: "user", uuid: "u1", text: "Peti kayu" }),
        stored({
          type: "question",
          questionId: "q1",
          questions: [
            {
              question: "Engsel di belakang perlu terlihat jelas?",
              header: "Engsel",
              multiSelect: false,
              options: [
                { label: "Ya, engsel besi besar", description: "Terlihat dari belakang" },
                { label: "Tidak perlu", description: "Engsel tersembunyi" },
              ],
            },
          ],
        }),
      ],
    );
    let body: unknown = null;
    server.on("POST", "/api/assets/peti/answers/q1", async (request) => {
      body = await request.json();
      return jsonResponse({
        asset: assetFixture({ status: "BRIEFING", runState: "running", currentVersion: null }),
      });
    });
    const { user } = await renderSession();
    expect(await screen.findByRole("heading", { name: t.dock.waiting.title })).toBeDefined();
    expect(composer().disabled).toBe(true);
    expect(composer().getAttribute("placeholder")).toBe(t.composer.waitingPlaceholder);
    await user.click(await screen.findByRole("radio", { name: /Ya, engsel besi besar/ }));
    await user.click(screen.getByRole("button", { name: t.question.submit }));
    await waitFor(() =>
      expect(body).toEqual({
        answers: { "Engsel di belakang perlu terlihat jelas?": { selected: ["Ya, engsel besi besar"] } },
      }),
    );
  });

  test("event state live mengganti Badge dan dock tanpa memuat ulang; Stop mengirim stop", async () => {
    serve(detailFixture(), reviewThread());
    server.on("POST", "/api/assets/peti/stop", {
      asset: assetFixture({ status: "BASE_WORKING", runState: "interrupted" }),
    });
    const { user } = await renderSession();
    expect(await screen.findByRole("heading", { name: t.dock.baseReview.title("v1") })).toBeDefined();
    const detailLoads = server.calls("GET", "/api/assets/peti").length;
    act(() =>
      realtime.emit(TOPIC, {
        type: "thread",
        stored: stored({
          type: "state",
          status: "BASE_WORKING",
          runState: "running",
          lastError: null,
          approvedBaseVersion: null,
          currentVersion: 1,
          buildsLeft: 6,
        }),
      }),
    );
    expect(await screen.findByRole("heading", { name: t.dock.working.title })).toBeDefined();
    expect(screen.getByText(t.status.working)).toBeDefined();
    expect(server.calls("GET", "/api/assets/peti")).toHaveLength(detailLoads);
    await user.click(screen.getByRole("button", { name: t.dock.stop }));
    expect(server.calls("POST", "/api/assets/peti/stop")).toHaveLength(1);
  });

  test("giliran gagal saat bentuk dasar dikerjakan: kartu Coba lagi mengirim retry; terputus: Lanjutkan mengirim resume", async () => {
    serve(
      detailFixture({
        asset: assetFixture({ status: "BASE_WORKING", runState: "failed", currentVersion: 1 }),
      }),
      reviewThread(),
    );
    server.on("POST", "/api/assets/peti/retry", {
      asset: assetFixture({ status: "BASE_WORKING", runState: "running", currentVersion: 1 }),
    });
    server.on("POST", "/api/assets/peti/resume", {
      asset: assetFixture({ status: "BASE_WORKING", runState: "running", currentVersion: 1 }),
    });
    const { user } = await renderSession();
    expect(await screen.findByRole("heading", { name: t.dock.failed.title })).toBeDefined();
    await user.click(screen.getByRole("button", { name: t.dock.failed.retry }));
    expect(await screen.findByRole("heading", { name: t.dock.working.title })).toBeDefined();
    expect(server.calls("POST", "/api/assets/peti/retry")).toHaveLength(1);
    act(() =>
      realtime.emit(TOPIC, {
        type: "thread",
        stored: stored({
          type: "state",
          status: "BASE_WORKING",
          runState: "interrupted",
          lastError: null,
          approvedBaseVersion: null,
          currentVersion: 1,
          buildsLeft: 6,
        }),
      }),
    );
    await user.click(await screen.findByRole("button", { name: t.dock.interrupted.resume }));
    await waitFor(() => expect(server.calls("POST", "/api/assets/peti/resume")).toHaveLength(1));
  });

  test("review final: Ubah bentuk dasar membuka dialog yang mengirim change-shape", async () => {
    serve(
      detailFixture({
        asset: assetFixture({ status: "TEXTURE_REVIEW", approvedBaseVersion: 1, currentVersion: 2 }),
        versions: [versionFixture(), versionFixture({ n: 2, stage: "textured" })],
      }),
      reviewThread(),
    );
    let body: unknown = null;
    server.on("POST", "/api/assets/peti/change-shape", async (request) => {
      body = await request.json();
      return jsonResponse({
        asset: assetFixture({
          status: "BASE_WORKING",
          runState: "running",
          approvedBaseVersion: null,
          currentVersion: 2,
        }),
      });
    });
    const { user } = await renderSession();
    await user.click(await screen.findByRole("button", { name: t.dock.finalReview.changeShape }));
    const dialog = await screen.findByRole("dialog", { name: t.changeShape.title });
    await user.type(within(dialog).getByRole("textbox", { name: t.changeShape.label }), "Tutup lebih rendah");
    await user.click(within(dialog).getByRole("button", { name: t.changeShape.confirm }));
    await waitFor(() => expect(body).toEqual({ text: "Tutup lebih rendah" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  test("kamera: tangkapan viewport menjadi lampiran pesan revisi dan ikut terkirim", async () => {
    serve(detailFixture(), reviewThread());
    server.on("POST", "/api/assets/peti/messages", {
      asset: assetFixture({ status: "BASE_WORKING", runState: "running" }),
    });
    const { user } = await renderSession();
    await user.click(screen.getByRole("button", { name: t.composer.capture }));
    const chips = await screen.findByRole("list", { name: t.composer.pendingAttachments });
    expect(within(chips).getByText(t.composer.captureName(1))).toBeDefined();
    expect(within(chips).getByText(t.composer.captureMeta(t.viewer.modes.clay, "8 B"))).toBeDefined();

    await user.type(composer(), "Bagian ini terlalu tipis{Enter}");
    await waitFor(() => expect(server.calls("POST", "/api/assets/peti/messages")).toHaveLength(1));
    const [request] = server.calls("POST", "/api/assets/peti/messages");
    const form = await request?.formData();
    expect(form?.get("text")).toBe("Bagian ini terlalu tipis");
    const files = form?.getAll("files[]") ?? [];
    expect(files.map((file) => (file instanceof File ? file.name : file))).toEqual([
      t.composer.captureName(1),
    ]);
    await waitFor(() =>
      expect(screen.queryByRole("list", { name: t.composer.pendingAttachments })).toBeNull(),
    );
  });

  test("memilih versi lama di panel Detail mengganti viewer dan Unduh; kartu Selesai tetap versi terkini", async () => {
    serve(
      detailFixture({
        asset: assetFixture({ status: "DONE", currentVersion: 2, approvedBaseVersion: 1 }),
        versions: [versionFixture({ n: 1 }), versionFixture({ n: 2, stage: "textured" })],
      }),
      reviewThread(),
    );
    const { user } = await renderSession();
    const viewer = screen.getByRole("region", { name: t.viewer.region });
    expect(within(viewer).getByText(/final · \/api\/assets\/peti\/versions\/2\/web\.glb/)).toBeDefined();

    await user.click(within(viewer).getByRole("radio", { name: /^v1/ }));
    expect(within(viewer).getByText(/base · \/api\/assets\/peti\/versions\/1\/web\.glb/)).toBeDefined();
    expect(screen.getByRole("link", { name: t.session.download }).getAttribute("download")).toBe(
      "peti-harta-kayu-v1.glb",
    );
    const done = screen.getByRole("region", { name: t.dock.done.title("v2") });
    expect(within(done).getByRole("link", { name: t.dock.done.download }).getAttribute("download")).toBe(
      "peti-harta-kayu-v2.glb",
    );
  });

  test("belum ada versi: viewport kosong, tanpa Unduh dan tanpa tombol kamera", async () => {
    serve(
      detailFixture({
        asset: assetFixture({ status: "BRIEFING", runState: "running", currentVersion: null }),
        versions: [],
      }),
      [stored({ type: "user", uuid: "u1", text: "Peti kayu" })],
    );
    await renderSession();
    expect(await screen.findByRole("heading", { name: t.session.emptyViewport.title })).toBeDefined();
    expect(screen.queryByRole("link", { name: t.session.download })).toBeNull();
    expect(screen.queryByRole("button", { name: t.composer.capture })).toBeNull();
  });

  test("koneksi terputus: banner di live region yang selalu terpasang; fokus tidak hilang saat banner lenyap", async () => {
    serve(detailFixture(), reviewThread());
    const { user } = await renderSession();
    await screen.findByRole("heading", { level: 1, name: "Peti harta kayu" });
    // Region dipasang kosong sejak awal, supaya isi yang muncul diumumkan pembaca layar.
    const region = screen.getByRole("status", { name: t.connection.status });
    expect(region.textContent).toBe("");
    act(() => realtime.setState("reconnecting"));
    expect(within(region).getByText(t.connection.lost)).toBeDefined();
    const reconnect = within(region).getByRole("button", { name: t.connection.reconnect });
    await user.click(reconnect);
    expect(realtime.reconnects).toBe(1);
    expect(document.activeElement).toBe(reconnect);
    act(() => realtime.setState("open"));
    expect(screen.queryByText(t.connection.lost)).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  test("pesan masih terkirim lalu Stop: setelah respons pesan tiba, composer tetap dikosongkan", async () => {
    serve(
      detailFixture({ asset: assetFixture({ status: "BASE_WORKING", runState: "running" }) }),
      reviewThread(),
    );
    let release: (response: Response) => void = () => undefined;
    server.on(
      "POST",
      "/api/assets/peti/messages",
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    server.on("POST", "/api/assets/peti/stop", {
      asset: assetFixture({ status: "BASE_WORKING", runState: "idle" }),
    });
    const { user } = await renderSession();
    await user.type(composer(), "Tutup lebih tebal{Enter}");
    await waitFor(() => expect(server.calls("POST", "/api/assets/peti/messages")).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: t.dock.stop }));
    await waitFor(() => expect(server.calls("POST", "/api/assets/peti/stop")).toHaveLength(1));
    await act(async () =>
      release(jsonResponse({ asset: assetFixture({ status: "BASE_WORKING", runState: "running" }) })),
    );
    await waitFor(() => expect(composer().value).toBe(""));
  });

  test("respons aksi yang tiba setelah event state lebih baru tidak memundurkan dock", async () => {
    serve(detailFixture(), reviewThread());
    let release: (response: Response) => void = () => undefined;
    server.on(
      "POST",
      "/api/assets/peti/approve",
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const { user } = await renderSession();
    await waitFor(() => expect(server.calls("GET", "/api/assets")).toHaveLength(1));
    await user.click(await screen.findByRole("button", { name: t.dock.baseReview.approve }));
    await waitFor(() => expect(server.calls("POST", "/api/assets/peti/approve")).toHaveLength(1));
    // Server cepat (mode palsu): tahap tekstur sudah selesai sebelum respons approve diproses klien.
    act(() =>
      realtime.emit(TOPIC, {
        type: "thread",
        stored: stored({
          type: "state",
          status: "TEXTURE_REVIEW",
          runState: "idle",
          lastError: null,
          approvedBaseVersion: 1,
          currentVersion: 2,
          buildsLeft: 4,
        }),
      }),
    );
    expect(await screen.findByRole("heading", { name: t.dock.finalReview.title("v2") })).toBeDefined();
    await act(async () =>
      release(
        jsonResponse({
          asset: assetFixture({ status: "TEXTURE_WORKING", runState: "running", approvedBaseVersion: 1 }),
        }),
      ),
    );
    await waitFor(() => expect(server.calls("GET", "/api/assets")).toHaveLength(2));
    expect(screen.getByRole("heading", { name: t.dock.finalReview.title("v2") })).toBeDefined();
    expect(screen.queryByRole("heading", { name: t.dock.working.title })).toBeNull();
  });

  test("detail gagal dimuat ulang: sesi dan draf tetap tampil, kegagalan dilaporkan lewat toast", async () => {
    serve(detailFixture(), reviewThread());
    const { user } = await renderSession();
    await screen.findByRole("heading", { level: 1, name: "Peti harta kayu" });
    await user.type(composer(), "Draf revisi");
    server.on("GET", "/api/assets/peti", () => jsonResponse({ code: "INTERNAL", message: "Galat." }, 500));
    const loads = server.calls("GET", "/api/assets/peti").length;
    // Event build memuat ulang detail (invalidasi).
    act(() =>
      realtime.emit(TOPIC, {
        type: "thread",
        stored: stored({ type: "build_finished", jobId: "j2", ok: false, code: "CANCELLED" }),
      }),
    );
    await waitFor(() => expect(server.calls("GET", "/api/assets/peti").length).toBeGreaterThan(loads));
    expect(await screen.findByText(t.session.refreshFailed)).toBeDefined();
    expect(screen.getByRole("heading", { level: 1, name: "Peti harta kayu" })).toBeDefined();
    expect(screen.queryByRole("heading", { level: 1, name: t.session.error.title })).toBeNull();
    expect(composer().value).toBe("Draf revisi");
  });

  test("tangkapan viewport gagal → toast dan log, tanpa lampiran", async () => {
    serve(detailFixture(), reviewThread());
    const logged = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { user } = await renderSession(BrokenCaptureViewer);
      await user.click(screen.getByRole("button", { name: t.composer.capture }));
      expect(await screen.findByText(t.composer.captureFailed)).toBeDefined();
      expect(screen.queryByRole("list", { name: t.composer.pendingAttachments })).toBeNull();
      expect(logged).toHaveBeenCalledWith("Tangkapan viewport:", expect.any(Error));
    } finally {
      logged.mockRestore();
    }
  });

  test("pembaca layar: kartu dock dan balasan Claude yang baru diumumkan; riwayat tidak", async () => {
    serve(detailFixture(), reviewThread());
    await renderSession();
    const announced = () => screen.getAllByRole("status").map((region) => region.textContent ?? "");
    await waitFor(() => expect(announced()).toContain(t.dock.baseReview.title("v1")));
    expect(announced().some((text) => text.includes("Saya buat bentuk dasarnya dulu."))).toBe(false);

    act(() =>
      realtime.emit(TOPIC, {
        type: "thread",
        stored: stored({
          type: "state",
          status: "BASE_WORKING",
          runState: "running",
          lastError: null,
          approvedBaseVersion: null,
          currentVersion: 1,
          buildsLeft: 6,
        }),
      }),
    );
    await waitFor(() => expect(announced()).toContain(t.dock.working.title));
    act(() =>
      realtime.emit(TOPIC, {
        type: "thread",
        stored: stored({ type: "assistant", text: "Tutupnya saya buat lebih melengkung." }),
      }),
    );
    await waitFor(() =>
      expect(announced()).toContain(t.thread.replyAnnouncement("Tutupnya saya buat lebih melengkung.")),
    );
  });

  test("aset tidak ditemukan → state kosong dengan jalan kembali", async () => {
    server.on("GET", "/api/assets/peti", () =>
      jsonResponse({ code: "ASSET_NOT_FOUND", message: "Aset peti tidak ditemukan." }, 404),
    );
    server.on("GET", "/api/assets/peti/events", { events: [], hasMore: false });
    const { user, router } = await renderSession();
    expect(await screen.findByRole("heading", { level: 1, name: t.session.notFound.title })).toBeDefined();
    await user.click(screen.getByRole("link", { name: t.session.notFound.back }));
    expect(router.state.location.pathname).toBe("/");
  });

  test("gagal dimuat → Coba lagi memuat ulang detail", async () => {
    server.on("GET", "/api/assets/peti", () => jsonResponse({ code: "INTERNAL", message: "Galat." }, 500));
    server.on("GET", "/api/assets/peti/events", { events: reviewThread(), hasMore: false });
    const { user } = await renderSession();
    expect(await screen.findByRole("heading", { level: 1, name: t.session.error.title })).toBeDefined();
    server.on("GET", "/api/assets/peti", detailFixture());
    await user.click(screen.getByRole("button", { name: t.session.error.retry }));
    expect(await screen.findByRole("heading", { level: 1, name: "Peti harta kayu" })).toBeDefined();
  });

  test("aset dihapus dari tab lain → state Aset sudah dihapus", async () => {
    serve(detailFixture(), reviewThread());
    await renderSession();
    await screen.findByRole("heading", { level: 1, name: "Peti harta kayu" });
    act(() => realtime.emit(TOPIC, { type: "asset_deleted" }));
    expect(await screen.findByRole("heading", { level: 1, name: t.session.deleted.title })).toBeDefined();
  });

  test("menu “…” di topbar: aksi aset tanpa Lanjutkan di Studio; Ekspor membuka dialog untuk versi yang dilihat", async () => {
    serve(detailFixture(), reviewThread());
    server.on("GET", "/api/assets/peti/export/estimate", { version: 1, presets: [] });
    const { user } = await renderSession();
    await screen.findByRole("heading", { level: 1, name: "Peti harta kayu" });
    const trigger = screen.getByRole("button", { name: t.assetActions.menu });
    await user.click(trigger);
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      t.assetActions.export,
      t.assetActions.rename,
      t.assetActions.duplicate,
      t.assetActions.delete,
    ]);
    await user.click(screen.getByRole("menuitem", { name: t.assetActions.export }));
    const dialog = await screen.findByRole("dialog", { name: t.assetActions.exportDialog.title });
    expect(
      await within(dialog).findByRole("button", {
        name: `${t.assetActions.exportDialog.version} v1 · Bentuk dasar`,
      }),
    ).toBeDefined();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  test("hapus dari menu “…”: sesi tetap tampil di balik dialog walau event hapus tiba lebih dulu, lalu ke Studio baru", async () => {
    serve(detailFixture(), reviewThread());
    let respond: () => void = () => undefined;
    server.on(
      "DELETE",
      "/api/assets/peti",
      () =>
        new Promise<Response>((resolve) => {
          respond = () => resolve(new Response(null, { status: 204 }));
        }),
    );
    const { user, router } = await renderSession();
    await screen.findByRole("heading", { level: 1, name: "Peti harta kayu" });
    await user.click(screen.getByRole("button", { name: t.assetActions.menu }));
    await user.click(screen.getByRole("menuitem", { name: t.assetActions.delete }));
    const dialog = await screen.findByRole("dialog", { name: t.assetActions.deleteDialog.title });
    await user.click(within(dialog).getByRole("button", { name: t.assetActions.deleteDialog.confirm }));
    await waitFor(() => expect(server.calls("DELETE", "/api/assets/peti")).toHaveLength(1));
    // Server menyiarkan `asset_deleted` sebelum respons HTTP tiba: halaman tidak berkedip ke "Aset sudah dihapus".
    act(() => realtime.emit(TOPIC, { type: "asset_deleted" }));
    // Dialog modal menyembunyikan isi halaman dari pohon aksesibilitas (`aria-hidden`), jadi dicari dengan `hidden`.
    expect(screen.queryByRole("heading", { name: t.session.deleted.title, hidden: true })).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Peti harta kayu", hidden: true })).toBeDefined();
    respond();
    expect(await screen.findByText("Studio baru")).toBeDefined();
    expect(router.state.location.pathname).toBe("/");
    // Studio baru memindah fokus ke kolom prompt (elemen asal sudah hilang; fokus tidak jatuh ke `body`).
    expect(router.state.location.state).toEqual(arrivalState("prompt"));
    expect(await screen.findByText(t.assetActions.deleted("Peti harta kayu"))).toBeDefined();
  });
});
