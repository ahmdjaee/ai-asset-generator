import { describe, expect, mock, test } from "bun:test";
import { act, screen, within } from "@testing-library/react";
import { t } from "@/i18n/id.ts";
import { ClockProvider } from "@/lib/clock.tsx";
import { T0 } from "@/test-assets.ts";
import { FakeClock } from "@/test-clock.ts";
import { renderUi } from "@/test-utils.tsx";
import { Dock, type DockActions, type DockState, dockState } from "./Dock.tsx";

describe("dockState", () => {
  const asset = (
    status: Parameters<typeof dockState>[0]["status"],
    runState: Parameters<typeof dockState>[0]["runState"],
    currentVersion: number | null = 1,
  ) => ({
    status,
    runState,
    currentVersion,
  });

  test("Claude bekerja: tahap dari status, versi berikutnya dari versi terbaru", () => {
    expect(dockState(asset("BRIEFING", "running", null), null)).toEqual({
      kind: "working",
      stage: "base",
      nextVersion: 1,
    });
    expect(dockState(asset("TEXTURE_WORKING", "running", 2), 3)).toEqual({
      kind: "working",
      stage: "textured",
      nextVersion: 4,
    });
    expect(dockState(asset("BRIEFING", "waiting_user", null), null)).toEqual({ kind: "waiting" });
  });

  test("diam: kartu review/selesai untuk versi terkini; tahap kerja tanpa proses atau tanpa versi: tanpa kartu", () => {
    expect(dockState(asset("BASE_REVIEW", "idle", 2), 2)).toEqual({ kind: "baseReview", version: 2 });
    expect(dockState(asset("TEXTURE_REVIEW", "idle", 3), 3)).toEqual({ kind: "finalReview", version: 3 });
    expect(dockState(asset("DONE", "idle", 3), 3)).toEqual({ kind: "done", version: 3 });
    expect(dockState(asset("BASE_WORKING", "idle", 1), 1)).toEqual({ kind: "none" });
    expect(dockState(asset("BASE_REVIEW", "idle", null), null)).toEqual({ kind: "none" });
  });

  test("giliran gagal atau terputus saat tahap masih dikerjakan (juga tanpa versi): Coba lagi / Lanjutkan", () => {
    expect(dockState(asset("BASE_WORKING", "failed", 2), 2)).toEqual({ kind: "failed" });
    expect(dockState(asset("BRIEFING", "failed", null), null)).toEqual({ kind: "failed" });
    expect(dockState(asset("TEXTURE_WORKING", "interrupted", 2), 3)).toEqual({ kind: "interrupted" });
    expect(dockState(asset("BRIEFING", "interrupted", null), null)).toEqual({ kind: "interrupted" });
  });

  test("giliran gagal atau terputus setelah versi dikirim: kartu review tetap ada (server tetap menerima aksinya)", () => {
    // Mis. batas pemakaian sesudah submit, atau server berhenti sebelum giliran selesai (pemulihan → interrupted).
    expect(dockState(asset("BASE_REVIEW", "failed", 2), 2)).toEqual({ kind: "baseReview", version: 2 });
    expect(dockState(asset("BASE_REVIEW", "interrupted", 2), 2)).toEqual({ kind: "baseReview", version: 2 });
    expect(dockState(asset("TEXTURE_REVIEW", "interrupted", 3), 3)).toEqual({
      kind: "finalReview",
      version: 3,
    });
    expect(dockState(asset("DONE", "failed", 3), 3)).toEqual({ kind: "done", version: 3 });
  });
});

function actions(patch: Partial<DockActions> = {}): DockActions {
  return {
    stop: mock(),
    approve: mock(),
    finish: mock(),
    revise: mock(),
    changeShape: mock(),
    retry: mock(),
    resume: mock(),
    pending: null,
    ...patch,
  };
}

function renderDock(state: DockState, dockActions: DockActions, clock = new FakeClock(T0)) {
  return renderUi(
    <ClockProvider clock={clock}>
      <Dock
        state={state}
        workingSince={T0 - 65_000}
        downloadUrl="/api/assets/peti/versions/3/web.glb"
        downloadName="peti-harta-kayu-v3.glb"
        actions={dockActions}
        composer={<p>Composer</p>}
      />
    </ClockProvider>,
  );
}

describe("Dock", () => {
  test("Claude bekerja: tahap + versi + lama giliran yang terus berjalan; Stop", async () => {
    const clock = new FakeClock(T0);
    const dockActions = actions();
    const { user } = renderDock({ kind: "working", stage: "base", nextVersion: 2 }, dockActions, clock);
    const card = screen.getByRole("region", { name: t.dock.working.title });
    expect(within(card).getByText("Bentuk dasar v2 · 1 mnt 5 dtk")).toBeDefined();
    act(() => clock.advance(2_000));
    expect(within(card).getByText("Bentuk dasar v2 · 1 mnt 7 dtk")).toBeDefined();
    await user.click(within(card).getByRole("button", { name: t.dock.stop }));
    expect(dockActions.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Composer")).toBeDefined();
  });

  test("Stop yang sedang dikirim memuat; menunggu jawaban juga bisa dihentikan", () => {
    renderDock({ kind: "waiting" }, actions({ pending: "stop" }));
    const card = screen.getByRole("region", { name: t.dock.waiting.title });
    expect(within(card).getByText(t.dock.waiting.description)).toBeDefined();
    expect(within(card).getByRole("button", { name: t.dock.stop }).getAttribute("aria-busy")).toBe("true");
  });

  test("review bentuk dasar: Setujui (memuat saat dikirim) dan Minta revisi", async () => {
    const dockActions = actions();
    const { user, unmount } = renderDock({ kind: "baseReview", version: 1 }, dockActions);
    const card = screen.getByRole("region", { name: t.dock.baseReview.title("v1") });
    await user.click(within(card).getByRole("button", { name: t.dock.baseReview.approve }));
    await user.click(within(card).getByRole("button", { name: t.dock.revise }));
    expect(dockActions.approve).toHaveBeenCalledTimes(1);
    expect(dockActions.revise).toHaveBeenCalledTimes(1);
    unmount();
    renderDock({ kind: "baseReview", version: 1 }, actions({ pending: "approve" }));
    expect(screen.getByRole("button", { name: t.dock.baseReview.approve }).getAttribute("aria-busy")).toBe(
      "true",
    );
  });

  test("review final: Selesai, Minta revisi, dan Ubah bentuk dasar", async () => {
    const dockActions = actions();
    const { user } = renderDock({ kind: "finalReview", version: 3 }, dockActions);
    const card = screen.getByRole("region", { name: t.dock.finalReview.title("v3") });
    await user.click(within(card).getByRole("button", { name: t.dock.finalReview.finish }));
    await user.click(within(card).getByRole("button", { name: t.dock.finalReview.changeShape }));
    expect(dockActions.finish).toHaveBeenCalledTimes(1);
    expect(dockActions.changeShape).toHaveBeenCalledTimes(1);
  });

  test("selesai: Unduh GLB mengunduh web.glb versi final", () => {
    renderDock({ kind: "done", version: 3 }, actions());
    const card = screen.getByRole("region", { name: t.dock.done.title("v3") });
    const link = within(card).getByRole("link", { name: t.dock.done.download });
    expect(link.getAttribute("href")).toBe("/api/assets/peti/versions/3/web.glb");
    expect(link.getAttribute("download")).toBe("peti-harta-kayu-v3.glb");
  });

  test("giliran gagal: Coba lagi (memuat saat dikirim); terputus: Lanjutkan", async () => {
    const sending = renderDock({ kind: "failed" }, actions({ pending: "retry" }));
    const failed = screen.getByRole("region", { name: t.dock.failed.title });
    expect(within(failed).getByText(t.dock.failed.description)).toBeDefined();
    const retry = within(failed).getByRole("button", { name: t.dock.failed.retry });
    expect(retry.getAttribute("aria-busy")).toBe("true");
    sending.unmount();
    const fresh = actions();
    const { user, unmount } = renderDock({ kind: "failed" }, fresh);
    await user.click(screen.getByRole("button", { name: t.dock.failed.retry }));
    unmount();
    expect(fresh.retry).toHaveBeenCalledTimes(1);
    renderDock({ kind: "interrupted" }, fresh);
    const interrupted = screen.getByRole("region", { name: t.dock.interrupted.title });
    expect(within(interrupted).getByText(t.dock.interrupted.description)).toBeDefined();
    await user.click(within(interrupted).getByRole("button", { name: t.dock.interrupted.resume }));
    expect(fresh.resume).toHaveBeenCalledTimes(1);
  });

  test("tanpa kartu: hanya composer", () => {
    renderDock({ kind: "none" }, actions());
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.getByText("Composer")).toBeDefined();
  });
});
