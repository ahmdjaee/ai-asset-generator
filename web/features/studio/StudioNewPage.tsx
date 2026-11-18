import { ChevronRight, CircleCheck, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { GuideDialog } from "@/app/shell/GuideDialog.tsx";
import { Breadcrumb, Topbar } from "@/app/shell/Topbar.tsx";
import { InfoBlock } from "@/components/InfoBlock.tsx";
import { StageStepper } from "@/components/StageStepper.tsx";
import { Thumbnail } from "@/components/Thumbnail.tsx";
import { TierInfo } from "@/components/Tier.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { notify } from "@/components/ui/toast.tsx";
import { StatusBanners } from "@/features/status/StatusBanners.tsx";
import { t } from "@/i18n/id.ts";
import { useArrivalFocus } from "@/lib/arrival-focus.ts";
import { assetBadge } from "@/lib/asset-status.ts";
import { thumbUrl } from "@/lib/asset-urls.ts";
import { useAssets } from "@/lib/assets.ts";
import { useNow } from "@/lib/clock.tsx";
import { useSettings } from "@/lib/settings.ts";
import { formatRelativeTime } from "../../../shared/format.ts";
import { DEFAULT_TIERS, type TierId } from "../../../shared/limits.ts";
import { DEFAULT_TIER_ID } from "../../../shared/settings.ts";
import { PromptComposer, useComposerDraft } from "./Composer.tsx";
import { useCreateAsset } from "./queries.ts";

/** Jumlah kartu "Terakhir dibuat" (FigCraft #920: empat kartu mini selebar konten). */
const RECENT_COUNT = 4;

/** Chip contoh (FigCraft #886): tinggi 28, padding-x 12, radius 14, garis `border/default`, Small `text/secondary`. */
function Examples({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-1">
      <span className="text-caption text-text-tertiary">{t.studio.examplesLabel}</span>
      {t.studio.examples.map((example) => (
        <button
          key={example.label}
          type="button"
          onClick={() => onPick(example.prompt)}
          className="h-7 whitespace-nowrap rounded-[14px] border border-border-default px-3 text-small text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          {example.label}
        </button>
      ))}
    </div>
  );
}

/** Kotak panduan (FigCraft #894): dua kolom (padding 16, jarak 6) dipisah garis 1 px, `bg/panel`, radius 12. */
function GuideBox() {
  const { guide } = t;
  return (
    <section
      aria-labelledby="studio-panduan"
      className="flex rounded-xl border border-border-default bg-bg-panel"
    >
      <h2 id="studio-panduan" className="sr-only">
        {t.studio.guideLabel}
      </h2>
      <div className="min-w-0 flex-1 p-4">
        <InfoBlock icon={CircleCheck} tone="text-success-text" title={guide.goodTitle} body={guide.good} />
      </div>
      <div aria-hidden className="w-px shrink-0 bg-border-default" />
      <div className="min-w-0 flex-1 p-4">
        <InfoBlock
          icon={TriangleAlert}
          tone="text-warning-text"
          title={guide.limitedTitle}
          body={guide.limited}
        />
      </div>
    </section>
  );
}

/**
 * Kartu mini (FigCraft #921): `bg/panel`, garis `border/default`, radius 10; thumbnail 112 `bg/viewport` (versi terkini;
 * aset tanpa versi hanya latar viewport); info padding 10/12/12/12, jarak 8: nama Label + baris Badge dan waktu Caption
 * `text/tertiary`.
 */
function MiniCard({
  asset,
  now,
}: {
  asset: Readonly<{
    id: string;
    name: string;
    status: Parameters<typeof assetBadge>[0]["status"];
    runState: Parameters<typeof assetBadge>[0]["runState"];
    updatedAt: number;
    current: Readonly<{ n: number; thumbnail: boolean }> | null;
  }>;
  now: number;
}) {
  const badge = assetBadge(asset);
  return (
    <li className="min-w-0">
      <Link
        to={`/studio/${encodeURIComponent(asset.id)}`}
        className="flex flex-col overflow-hidden rounded-[10px] border border-border-default bg-bg-panel transition-colors hover:border-border-strong"
      >
        <Thumbnail
          src={asset.current?.thumbnail === true ? thumbUrl(asset.id, asset.current.n) : undefined}
          className="h-28"
        />
        <span className="flex flex-col gap-2 px-3 pt-2.5 pb-3">
          <span className="truncate text-label text-text-primary">{asset.name}</span>
          <span className="flex items-center justify-between gap-2">
            <Badge tone={badge.tone}>{badge.label}</Badge>
            <span className="truncate text-caption text-text-tertiary">
              {formatRelativeTime(asset.updatedAt, now, "short")}
            </span>
          </span>
        </span>
      </Link>
    </li>
  );
}

/** "Terakhir dibuat" (FigCraft #913): Overline + "Buka Gudang", empat kartu mini terbaru; state memuat, kosong, error. */
function RecentAssets() {
  const assets = useAssets();
  // Waktu relatif kartu ("12 mnt") diperbarui tiap menit.
  const now = useNow(true, 60_000);
  let body: React.ReactNode;
  if (assets.isPending) {
    body = <p className="text-small text-text-secondary">{t.loading}</p>;
  } else if (assets.isError) {
    body = (
      <div className="flex items-center gap-3">
        <p className="text-small text-text-secondary">{t.studio.recentError}</p>
        <Button variant="secondary" size="sm" onClick={() => void assets.refetch()}>
          {t.studio.retry}
        </Button>
      </div>
    );
  } else if (assets.data.length === 0) {
    body = <p className="text-small text-text-secondary">{t.studio.recentEmpty}</p>;
  } else {
    const recent = [...assets.data].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT_COUNT);
    body = (
      <ul className="grid grid-cols-4 gap-4">
        {recent.map((asset) => (
          <MiniCard key={asset.id} asset={asset} now={now} />
        ))}
      </ul>
    );
  }
  return (
    <section aria-labelledby="studio-terakhir" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id="studio-terakhir" className="text-overline text-text-tertiary uppercase">
          {t.studio.recent}
        </h2>
        <Link
          to="/gudang"
          className="flex items-center gap-0.5 rounded-sm text-small text-accent-text hover:underline"
        >
          {t.studio.openGudang}
          <ChevronRight aria-hidden size={14} className="shrink-0" />
        </Link>
      </div>
      {body}
    </section>
  );
}

/**
 * Studio · baru (FigCraft #747): topbar tiga slot, kolom konten 720 px 44 px di bawah topbar, jarak 28. Composer +
 * info tier + chip contoh, kotak panduan, lalu "Terakhir dibuat". Kirim membuat aset dan membuka sesinya.
 */
export function StudioNewPage() {
  const draft = useComposerDraft();
  const settings = useSettings().data;
  // Pilihan pemilik di composer menang; sebelum memilih, tier bawaan dari Pengaturan.
  const [picked, setTier] = useState<TierId | null>(null);
  const tier = picked ?? settings?.defaultTier ?? DEFAULT_TIER_ID;
  const budget = settings?.tiers[tier] ?? DEFAULT_TIERS[tier];
  const create = useCreateAsset();
  const navigate = useNavigate();
  const prompt = useRef<HTMLTextAreaElement>(null);
  useArrivalFocus("prompt", prompt);

  const submit = () => {
    create.mutate(
      {
        prompt: draft.text.trim(),
        tierId: tier,
        files: draft.attachments.map((attachment) => attachment.file),
      },
      {
        onSuccess: (asset) => {
          draft.clear();
          void navigate(`/studio/${encodeURIComponent(asset.id)}`);
        },
        onError: (error) => notify.error(t.studio.createFailed, error.message),
      },
    );
  };

  return (
    <>
      <Topbar className="grid grid-cols-[1fr_auto_1fr] gap-4 pl-5">
        <Breadcrumb items={[{ label: t.nav.studio, to: "/" }, { label: t.studio.newAsset }]} />
        <StageStepper stage="new" />
        <div className="flex items-center justify-end gap-2">
          <GuideDialog />
        </div>
      </Topbar>
      <StatusBanners />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto box-content flex w-full max-w-180 flex-col gap-7 px-4 pt-11 pb-16">
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-display text-text-primary">{t.studio.title}</h1>
            <p className="max-w-135 text-body text-text-secondary">{t.studio.subtitle}</p>
          </div>
          <div className="flex flex-col gap-3">
            <PromptComposer
              draft={draft}
              tier={tier}
              onTierChange={setTier}
              sending={create.isPending}
              onSubmit={submit}
              textareaRef={prompt}
            />
            <TierInfo tier={tier} budget={budget} />
            <Examples
              onPick={(text) => {
                draft.setText(text);
                prompt.current?.focus();
              }}
            />
          </div>
          <GuideBox />
          <RecentAssets />
        </div>
      </div>
    </>
  );
}
