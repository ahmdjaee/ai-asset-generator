import { Box, Cuboid, Download, FileQuestion, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { RouteLoading } from "@/app/pages.tsx";
import { Breadcrumb, Topbar } from "@/app/shell/Topbar.tsx";
import { AttachmentChip } from "@/components/AttachmentChip.tsx";
import { BriefCard } from "@/components/BriefCard.tsx";
import { EmptyState } from "@/components/EmptyState.tsx";
import { TierIndicator } from "@/components/Tier.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { notify } from "@/components/ui/toast.tsx";
import { StatusBanners } from "@/features/status/StatusBanners.tsx";
import { t } from "@/i18n/id.ts";
import { ApiError } from "@/lib/api.ts";
import { arrivalState } from "@/lib/arrival-focus.ts";
import { assetBadge } from "@/lib/asset-status.ts";
import { attachmentUrl, versionFileUrl } from "@/lib/asset-urls.ts";
import { useNow } from "@/lib/clock.tsx";
import { formatDateTime, formatNumber, formatRelativeTime } from "../../../shared/format.ts";
import {
  type AssetActions,
  AssetActionsMenu,
  type AssetActionTarget,
  useAssetActions,
} from "../asset-actions/AssetActions.tsx";
import { detailPanelData, WEB_FILE } from "../studio/detail-panel.ts";
import {
  type AssetData,
  type AssetDetailData,
  type AttachmentData,
  useAssetDeleted,
  useAssetDetail,
} from "../studio/queries.ts";
import { shownVersion, type VersionPick } from "../studio/session.ts";
import { useSessionViewer } from "../studio/session-viewer.tsx";
import { gudangHref } from "./link-state.ts";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** State halaman tanpa aset (tidak ditemukan, gagal dimuat): Empty state di tengah area utama. */
function DetailState({
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-caption">
      <dt className="text-text-tertiary">{label}</dt>
      <dd className="text-right text-text-secondary">{value}</dd>
    </div>
  );
}

/**
 * Panel "Info aset" (FigCraft layar 04 #5137): lebar 400 (garis kanan), `bg/panel`, padding 20, jarak 24.
 * Prompt (Overline + Body + chip lampiran ringkas, jarak 10), Ringkasan brief, lalu Info (Dibuat, Diubah, Versi:
 * Caption `text/tertiary` ↔ `text/secondary`, jarak 8). Lampiran = semua lampiran aset, termasuk yang dikirim saat revisi.
 */
function AssetInfoPanel({
  asset,
  attachments,
  versionCount,
  now,
}: {
  asset: AssetData;
  attachments: readonly AttachmentData[];
  versionCount: number;
  now: number;
}) {
  const promptId = useId();
  const infoId = useId();
  const { assetDetail } = t;
  return (
    <section
      aria-label={assetDetail.info}
      className="flex w-100 shrink-0 flex-col gap-6 overflow-y-auto border-border-default border-r bg-bg-panel p-5"
    >
      <section aria-labelledby={promptId} className="flex flex-col gap-2.5">
        <h2 id={promptId} className="text-overline text-text-tertiary uppercase">
          {assetDetail.prompt}
        </h2>
        <p className="whitespace-pre-wrap break-words text-body text-text-primary">{asset.prompt}</p>
        {attachments.length === 0 ? null : (
          <ul aria-label={assetDetail.attachments} className="flex flex-wrap gap-1.5">
            {attachments.map((attachment) => (
              <li key={attachment.id} className="min-w-0 max-w-full">
                <AttachmentChip
                  compact
                  name={attachment.name}
                  {...(attachment.kind === "image"
                    ? { thumbnail: attachmentUrl(asset.id, attachment.id) }
                    : {})}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      {asset.brief === null ? null : <BriefCard brief={asset.brief} headingLevel={2} />}
      <section aria-labelledby={infoId} className="flex flex-col gap-2.5">
        <h2 id={infoId} className="text-overline text-text-tertiary uppercase">
          {assetDetail.infoTitle}
        </h2>
        <dl className="flex flex-col gap-2">
          <InfoRow label={assetDetail.created} value={formatDateTime(asset.createdAt)} />
          <InfoRow label={assetDetail.updated} value={formatRelativeTime(asset.updatedAt, now)} />
          <InfoRow
            label={assetDetail.versions}
            value={assetDetail.versionCount(formatNumber(versionCount))}
          />
        </dl>
      </section>
    </section>
  );
}

/**
 * Isi Detail aset (FigCraft layar 04 #5057): topbar (breadcrumb Gudang › nama + Tier + Badge; Lanjutkan di Studio,
 * Ekspor, menu "…"), panel Info aset 400 px, lalu viewport dengan panel detail yang sama dengan Studio.
 */
function Detail({
  data,
  back,
  actions,
}: {
  data: AssetDetailData;
  /** Tautan "Gudang" di breadcrumb (daftar dengan filter terakhir). */
  back: string;
  actions: AssetActions;
}) {
  const { asset, versions, attachments } = data;
  const [pick, setPick] = useState<VersionPick | null>(null);
  const exportButton = useRef<HTMLButtonElement>(null);
  const now = useNow(true, 60_000);
  const SessionViewer = useSessionViewer();
  const shown = shownVersion(
    pick,
    asset.currentVersion,
    versions.map((version) => version.n),
  );
  const version = versions.find((candidate) => candidate.n === shown) ?? null;
  const badge = assetBadge(asset);
  const target: AssetActionTarget = {
    id: asset.id,
    name: asset.name,
    version: shown,
    versionCount: versions.length,
  };

  return (
    <>
      <Topbar className="justify-between gap-4 pl-5">
        <Breadcrumb items={[{ label: t.gudang.title, to: back }, { label: asset.name }]}>
          {/* Sama dengan topbar sesi Studio (layar 02): jarak nama → Tier 18 px, Tier → Badge 14 px. */}
          <TierIndicator tier={asset.tierId} className="ml-3 text-text-tertiary" />
          <Badge tone={badge.tone} className="ml-2">
            {badge.label}
          </Badge>
        </Breadcrumb>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild variant="secondary" size="sm" icon={Box}>
            <Link to={`/studio/${encodeURIComponent(asset.id)}`}>{t.assetDetail.continueInStudio}</Link>
          </Button>
          <Button
            ref={exportButton}
            variant="primary"
            size="sm"
            icon={Download}
            disabled={shown === null}
            onClick={() => actions.run("export", target, exportButton.current)}
          >
            {t.assetDetail.export}
          </Button>
          <AssetActionsMenu target={target} onAction={actions.run} omit={["studio", "export"]} />
        </div>
      </Topbar>
      <StatusBanners />
      <div className="flex min-h-0 flex-1">
        <h1 className="sr-only">{asset.name}</h1>
        <AssetInfoPanel asset={asset} attachments={attachments} versionCount={versions.length} now={now} />
        <div className="flex min-w-0 flex-1 flex-col bg-bg-viewport">
          {version === null ? (
            <section aria-label={t.session.viewport} className="flex flex-1 items-center justify-center p-6">
              <EmptyState
                icon={Cuboid}
                title={t.session.emptyViewport.title}
                description={t.session.emptyViewport.description}
              />
            </section>
          ) : (
            <SessionViewer
              src={versionFileUrl(asset.id, version.n, WEB_FILE)}
              name={asset.name}
              stage={version.stage === "textured" ? "final" : "base"}
              detail={detailPanelData(asset, versions, version, now, (n) =>
                setPick({ version: n, current: asset.currentVersion }),
              )}
            />
          )}
        </div>
      </div>
    </>
  );
}

function AssetDetailContent({
  assetId,
  back,
  actions,
}: {
  assetId: string;
  back: string;
  actions: AssetActions;
}) {
  const detail = useAssetDetail(assetId);
  const deleted = useAssetDeleted(assetId);
  const notFound = detail.error instanceof ApiError && detail.error.code === "ASSET_NOT_FOUND";
  const failedAt = detail.isRefetchError && !notFound ? detail.errorUpdatedAt : 0;
  const reason = detail.isRefetchError ? message(detail.error) : "";
  useEffect(() => {
    if (failedAt !== 0) notify.error(t.session.refreshFailed, reason);
  }, [failedAt, reason]);

  const backLink = (
    <Button asChild variant="secondary" size="sm">
      <Link to={back}>{t.assetDetail.notFound.back}</Link>
    </Button>
  );
  // Aset dihapus dari halaman ini: data terakhir tetap tampil di balik dialog sampai kembali ke Gudang.
  if (actions.deletingId === assetId && detail.data !== undefined) {
    return <Detail data={detail.data} back={back} actions={actions} />;
  }
  if (deleted) {
    return (
      <DetailState
        icon={Trash2}
        title={t.assetDetail.deleted.title}
        description={t.assetDetail.deleted.description}
        action={backLink}
      />
    );
  }
  if (detail.isPending) return <RouteLoading />;
  if (notFound) {
    return (
      <DetailState
        icon={FileQuestion}
        title={t.assetDetail.notFound.title}
        description={t.assetDetail.notFound.description}
        action={backLink}
      />
    );
  }
  if (detail.isLoadingError) {
    return (
      <DetailState
        icon={RotateCcw}
        title={t.assetDetail.error.title}
        description={t.assetDetail.error.description}
        action={
          <Button variant="secondary" size="sm" onClick={() => void detail.refetch()}>
            {t.assetDetail.error.retry}
          </Button>
        }
      />
    );
  }
  return <Detail data={detail.data} back={back} actions={actions} />;
}

function AssetDetailScreen({ assetId }: { assetId: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const back = gudangHref(location.state);
  // Kembali ke Gudang (filter terakhir); fokus pindah ke kolom cari karena menu "…" di halaman ini ikut hilang.
  const actions = useAssetActions({
    onDeleted: () => void navigate(back, { state: arrivalState("search") }),
  });
  return (
    <>
      <AssetDetailContent assetId={assetId} back={back} actions={actions} />
      {actions.dialogs}
    </>
  );
}

/** Detail aset (`/gudang/:assetId`). Satu pemasangan per aset (`key`), supaya pilihan versi tidak terbawa. */
export function AssetDetailPage() {
  const { assetId = "" } = useParams();
  return <AssetDetailScreen key={assetId} assetId={assetId} />;
}
