import { Cuboid, Download, FileQuestion, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { RouteLoading } from "@/app/pages.tsx";
import { Breadcrumb, Topbar } from "@/app/shell/Topbar.tsx";
import { EmptyState } from "@/components/EmptyState.tsx";
import { LiveStatus } from "@/components/LiveStatus.tsx";
import { StageStepper } from "@/components/StageStepper.tsx";
import { TierIndicator } from "@/components/Tier.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { notify } from "@/components/ui/toast.tsx";
import { Tooltip } from "@/components/ui/tooltip.tsx";
import { t } from "@/i18n/id.ts";
import { ApiError } from "@/lib/api.ts";
import { arrivalState } from "@/lib/arrival-focus.ts";
import { assetBadge, stageProgress } from "@/lib/asset-status.ts";
import { attachmentUrl, versionFileUrl } from "@/lib/asset-urls.ts";
import { useNow } from "@/lib/clock.tsx";
import { fileStem } from "@/lib/download.ts";
import type { StoredEvent } from "../../../shared/asset-events.ts";
import { formatBytes } from "../../../shared/format.ts";
import { ANNOUNCE_EXCERPT_CHARS } from "../../../shared/limits.ts";
import { ellipsize } from "../../../shared/text.ts";
import {
  type AssetActions,
  AssetActionsMenu,
  type RunAssetAction,
  useAssetActions,
} from "../asset-actions/AssetActions.tsx";
import type { DetailPanelData } from "../viewer/DetailPanel.tsx";
import type { ViewerHandle } from "../viewer/Viewer.tsx";
import { ChangeShapeDialog } from "./ChangeShapeDialog.tsx";
import { DockComposer, useComposerDraft } from "./Composer.tsx";
import { Dock, type DockActions, dockAnnouncement, dockState } from "./Dock.tsx";
import { detailPanelData, WEB_FILE } from "./detail-panel.ts";
import {
  type AnswerPayload,
  type AssetAction,
  type AssetDetailData,
  useAssetAction,
  useAssetDeleted,
  useAssetDetail,
} from "./queries.ts";
import { ReconnectBanner } from "./ReconnectBanner.tsx";
import { shownVersion, turnStartedAt, type VersionPick } from "./session.ts";
import { useSessionViewer } from "./session-viewer.tsx";
import { ThreadView } from "./ThreadView.tsx";
import { threadItems } from "./thread-items.ts";
import { useAssetThread } from "./use-asset-thread.ts";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** State halaman tanpa sesi (tidak ditemukan, dihapus, gagal dimuat): Empty state di tengah area utama. */
function SessionState({
  icon,
  title,
  description,
  action,
}: {
  icon: typeof FileQuestion;
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
      <EmptyState icon={icon} headingLevel={1} title={title} description={description} action={action} />
    </div>
  );
}

function BackToStudio() {
  return (
    <Button asChild variant="secondary" size="sm">
      <Link to="/">{t.session.notFound.back}</Link>
    </Button>
  );
}

/**
 * Studio · sesi (FigCraft layar 02 #957): topbar (breadcrumb + Tier + Badge status, indikator tahap, Unduh), banner
 * sambung ulang, kolom Percakapan 400 px (thread + dock), lalu viewport. Satu pemasangan per aset (`key`).
 */
export function StudioSessionPage() {
  const { assetId = "" } = useParams();
  return <AssetSession key={assetId} assetId={assetId} />;
}

/** Muat ulang detail gagal (data lama tetap ada): sesi tetap tampil, kegagalannya dilaporkan sekali lewat toast. */
function useRefreshFailure(detail: ReturnType<typeof useAssetDetail>, notFound: boolean): void {
  const failedAt = detail.isRefetchError && !notFound ? detail.errorUpdatedAt : 0;
  const reason = detail.isRefetchError ? message(detail.error) : "";
  useEffect(() => {
    if (failedAt !== 0) notify.error(t.session.refreshFailed, reason);
  }, [failedAt, reason]);
}

function AssetSession({ assetId }: { assetId: string }) {
  const navigate = useNavigate();
  // Ke Studio baru; fokus pindah ke kolom prompt karena menu "…" di halaman ini ikut hilang.
  const actions = useAssetActions({ onDeleted: () => void navigate("/", { state: arrivalState("prompt") }) });
  return (
    <>
      <AssetSessionContent assetId={assetId} actions={actions} />
      {actions.dialogs}
    </>
  );
}

function AssetSessionContent({ assetId, actions }: { assetId: string; actions: AssetActions }) {
  const detail = useAssetDetail(assetId);
  const deleted = useAssetDeleted(assetId);
  const thread = useAssetThread(assetId);
  const notFound = detail.error instanceof ApiError && detail.error.code === "ASSET_NOT_FOUND";
  useRefreshFailure(detail, notFound);
  // Aset dihapus dari menu halaman ini: sesi terakhir tetap tampil di balik dialog sampai pindah ke Studio baru.
  if (actions.deletingId === assetId && detail.data !== undefined) {
    return <Session assetId={assetId} data={detail.data} thread={thread} onAction={actions.run} />;
  }
  if (thread.snapshot.deleted || deleted) {
    return (
      <SessionState
        icon={Trash2}
        title={t.session.deleted.title}
        description={t.session.deleted.description}
        action={<BackToStudio />}
      />
    );
  }
  if (detail.isPending) return <RouteLoading />;
  if (notFound) {
    return (
      <SessionState
        icon={FileQuestion}
        title={t.session.notFound.title}
        description={t.session.notFound.description}
        action={<BackToStudio />}
      />
    );
  }
  // Hanya pemuatan pertama yang gagal menggantikan sesi. Muat ulang yang gagal tetap menampilkan data terakhir, supaya
  // draf composer dan sudut viewer tidak hilang.
  if (detail.isLoadingError) {
    return (
      <SessionState
        icon={RotateCcw}
        title={t.session.error.title}
        description={t.session.error.description}
        action={
          <Button variant="secondary" size="sm" onClick={() => void detail.refetch()}>
            {t.session.error.retry}
          </Button>
        }
      />
    );
  }
  return <Session assetId={assetId} data={detail.data} thread={thread} onAction={actions.run} />;
}

/**
 * Balasan Claude yang masuk setelah thread selesai dimuat, untuk live region. Riwayat tidak diumumkan; stream delta
 * juga tidak, hanya pesan yang sudah utuh.
 */
function useReplyAnnouncement(events: readonly StoredEvent[], ready: boolean): string {
  const [baseline, setBaseline] = useState<number | null>(null);
  if (ready && baseline === null) setBaseline(events.at(-1)?.seq ?? 0);
  if (baseline === null) return "";
  const reply = events.findLast(
    (stored) => (stored.seq ?? 0) > baseline && stored.event.type === "assistant",
  );
  return reply?.event.type === "assistant"
    ? t.thread.replyAnnouncement(ellipsize(reply.event.text, ANNOUNCE_EXCERPT_CHARS))
    : "";
}

function captureFailed(error: unknown): void {
  console.error("Tangkapan viewport:", error);
  notify.error(t.composer.captureFailed);
}

function Session({
  assetId,
  data,
  thread,
  onAction,
}: {
  assetId: string;
  data: AssetDetailData;
  thread: ReturnType<typeof useAssetThread>;
  onAction: RunAssetAction;
}) {
  const { asset, versions } = data;
  const { snapshot } = thread;
  // Pesan dan aksi lain memakai mutasi terpisah: Stop saat pesan masih terkirim tidak menggeser status kirim composer.
  const outgoing = useAssetAction(assetId);
  const action = useAssetAction(assetId);
  const draft = useComposerDraft();
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const viewer = useRef<ViewerHandle>(null);
  const [pick, setPick] = useState<VersionPick | null>(null);
  const [changingShape, setChangingShape] = useState(false);
  const now = useNow(true, 60_000);
  const SessionViewer = useSessionViewer();

  const numbers = versions.map((version) => version.n);
  const latest = numbers.length === 0 ? null : Math.max(...numbers);
  const shown = shownVersion(pick, asset.currentVersion, numbers);
  const version = versions.find((candidate) => candidate.n === shown) ?? null;
  const running = asset.runState === "running";
  const dock = dockState(asset, latest);
  const badge = assetBadge(asset);

  const items = useMemo(
    () => threadItems({ events: snapshot.events, streaming: snapshot.streaming, running }),
    [snapshot.events, snapshot.streaming, running],
  );
  const reply = useReplyAnnouncement(snapshot.events, snapshot.phase === "ready");

  // `mutateAsync` per panggilan: hasil dan galat setiap aksi tetap sampai walau aksi lain dimulai sebelum selesai.
  const run = (request: AssetAction) => {
    void action
      .mutateAsync(request)
      .catch((error: unknown) => notify.error(t.session.actionFailed, message(error)));
  };
  const pendingAction = action.isPending ? action.variables.type : null;

  const actions: DockActions = {
    stop: () => run({ type: "stop" }),
    approve: () => run({ type: "approve" }),
    finish: () => run({ type: "finish" }),
    revise: () => composerInput.current?.focus(),
    changeShape: () => setChangingShape(true),
    pending:
      pendingAction === "stop" || pendingAction === "approve" || pendingAction === "finish"
        ? pendingAction
        : null,
  };

  const send = () => {
    const request: AssetAction = {
      type: "message",
      text: draft.text.trim(),
      files: draft.attachments.map((attachment) => attachment.file),
    };
    void outgoing.mutateAsync(request).then(
      () => draft.clear(),
      (error: unknown) => notify.error(t.composer.sendFailed, message(error)),
    );
  };

  /** Tombol kamera composer: PNG viewport (sudut dan mode sekarang) menjadi lampiran pesan. */
  const capture = async () => {
    const shot = (await viewer.current?.captureView()) ?? null;
    if (shot === null || shown === null) throw new Error("Viewer belum memberi tangkapan.");
    const name = t.composer.captureName(shown);
    draft.add(
      [new File([shot.blob], name, { type: "image/png" })],
      t.composer.captureMeta(t.viewer.modes[shot.mode], formatBytes(shot.blob.size)),
    );
  };

  const answer = async (questionId: string, answers: AnswerPayload) => {
    try {
      await action.mutateAsync({ type: "answer", questionId, answers });
    } catch (error) {
      notify.error(t.question.submitFailed, message(error));
      throw error;
    }
  };

  const changeShape = async (text: string) => {
    try {
      await action.mutateAsync({ type: "change_shape", text });
    } catch (error) {
      notify.error(t.session.actionFailed, message(error));
      throw error;
    }
  };

  const download = (n: number | null) =>
    n === null
      ? null
      : { url: versionFileUrl(assetId, n, WEB_FILE), name: `${fileStem(asset.name)}-v${n}.glb` };
  // Topbar mengunduh versi yang sedang dilihat; kartu "Aset selesai" selalu versi terkini (aset final).
  const viewed = download(shown);
  const final = download(asset.currentVersion);
  const downloadUrl = viewed?.url ?? null;
  const detailPanel: DetailPanelData | undefined =
    version === null
      ? undefined
      : detailPanelData(asset, versions, version, now, (n) =>
          setPick({ version: n, current: asset.currentVersion }),
        );

  return (
    <>
      <Topbar className="grid grid-cols-[1fr_auto_1fr] gap-4 pl-5">
        <Breadcrumb items={[{ label: t.nav.studio, to: "/" }, { label: asset.name }]}>
          {/* Spacer desain: jarak nama → Tier 18 px, Tier → Badge 14 px (jarak baris 6 + margin). */}
          {/* Layar 02 (#999): tier memakai `icon/color` mode `text/tertiary`. */}
          <TierIndicator tier={asset.tierId} className="ml-3 text-text-tertiary" />
          <Badge tone={badge.tone} className="ml-2">
            {badge.label}
          </Badge>
        </Breadcrumb>
        <StageStepper stage={stageProgress(asset.status)} />
        <div className="flex items-center justify-end gap-2">
          {viewed === null || shown === null ? null : (
            <Tooltip label={t.session.downloadHint(shown)} side="bottom">
              <Button asChild variant="secondary" size="sm" icon={Download}>
                <a href={viewed.url} download={viewed.name}>
                  {t.session.download}
                </a>
              </Button>
            </Tooltip>
          )}
          {/* Layar 02 (#1032): menu "…" sesudah Unduh; "Lanjutkan di Studio" tidak relevan di sini. */}
          <AssetActionsMenu
            target={{ id: assetId, name: asset.name, version: shown, versionCount: versions.length }}
            onAction={onAction}
            omit={["studio"]}
          />
        </div>
      </Topbar>
      <ReconnectBanner />
      <div className="flex min-h-0 flex-1">
        <h1 className="sr-only">{asset.name}</h1>
        <section
          aria-label={t.thread.label}
          className="flex w-100 shrink-0 flex-col border-border-default border-r bg-bg-panel"
        >
          <ThreadView
            className="min-h-0 flex-1"
            items={items}
            phase={snapshot.phase}
            hasMore={snapshot.hasMore}
            loadingOlder={snapshot.loadingOlder}
            onLoadOlder={() => void thread.loadOlder().catch(() => notify.error(t.thread.loadOlderFailed))}
            onRetry={thread.retry}
            context={{
              attachmentUrl: (attachmentId) => attachmentUrl(assetId, attachmentId),
              builds: snapshot.builds,
              timings: (n) => versions.find((candidate) => candidate.n === n)?.timings ?? null,
              nextVersion: dock.kind === "working" ? dock.nextVersion : null,
              questionOpen: asset.runState === "waiting_user",
              onAnswer: answer,
            }}
          />
          <Dock
            state={dock}
            workingSince={turnStartedAt(snapshot.events) ?? asset.updatedAt}
            downloadUrl={final?.url ?? null}
            downloadName={final?.name ?? ""}
            actions={actions}
            composer={
              <DockComposer
                draft={draft}
                placeholder={
                  asset.runState === "waiting_user"
                    ? t.composer.waitingPlaceholder
                    : t.composer.revisePlaceholder
                }
                disabled={asset.runState === "waiting_user"}
                sending={outgoing.isPending}
                onSubmit={send}
                textareaRef={composerInput}
                {...(shown === null ? {} : { onCapture: () => void capture().catch(captureFailed) })}
              />
            }
          />
          <LiveStatus text={dockAnnouncement(dock)} />
          <LiveStatus text={reply} />
        </section>
        <div className="flex min-w-0 flex-1 flex-col bg-bg-viewport">
          {version === null || downloadUrl === null ? (
            <section aria-label={t.session.viewport} className="flex flex-1 items-center justify-center p-6">
              <EmptyState
                icon={Cuboid}
                title={t.session.emptyViewport.title}
                description={t.session.emptyViewport.description}
              />
            </section>
          ) : (
            <SessionViewer
              ref={viewer}
              src={downloadUrl}
              name={asset.name}
              stage={version.stage === "textured" ? "final" : "base"}
              {...(detailPanel === undefined ? {} : { detail: detailPanel })}
            />
          )}
        </div>
      </div>
      {asset.currentVersion === null ? null : (
        <ChangeShapeDialog
          open={changingShape}
          onOpenChange={setChangingShape}
          version={asset.approvedBaseVersion ?? asset.currentVersion}
          onSubmit={changeShape}
        />
      )}
    </>
  );
}
