import { LayoutGrid, List, Package, Plus, RotateCcw, Search, SquareCheck, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { z } from "zod";
import { Topbar } from "@/app/shell/Topbar.tsx";
import { AssetCard } from "@/components/AssetCard.tsx";
import { EmptyState } from "@/components/EmptyState.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Dropdown } from "@/components/ui/dropdown.tsx";
import { SearchField } from "@/components/ui/search-field.tsx";
import { Segmented } from "@/components/ui/segmented.tsx";
import { notify } from "@/components/ui/toast.tsx";
import { t } from "@/i18n/id.ts";
import { useArrivalFocus } from "@/lib/arrival-focus.ts";
import { assetBadge } from "@/lib/asset-status.ts";
import { thumbUrl, turntableUrl } from "@/lib/asset-urls.ts";
import { type AssetListItemData, useAssetList } from "@/lib/assets.ts";
import { useClock, useNow } from "@/lib/clock.tsx";
import { isTypingTarget } from "@/lib/keyboard.ts";
import { cn } from "@/lib/utils.ts";
import { ASSET_SORTS, hasListFilter, STAGE_FILTERS } from "../../../shared/asset-list.ts";
import { formatNumber, formatRelativeTime } from "../../../shared/format.ts";
import { ASSET_SEARCH_MAX_CHARS, TIER_IDS } from "../../../shared/limits.ts";
import {
  type AssetActionKind,
  AssetActionsMenu,
  type AssetActionTarget,
  useAssetActions,
} from "../asset-actions/AssetActions.tsx";
import { AssetRow, AssetRowsHeader } from "./AssetRow.tsx";
import { assetInfo, assetProgress } from "./asset-info.ts";
import { gudangLinkState } from "./link-state.ts";
import {
  clearFilters,
  DATE_FILTERS,
  dateSince,
  type GudangParams,
  type GudangView,
  gudangSearch,
  listQuery,
  parseGudangParams,
} from "./list-state.ts";
import { SelectionBar } from "./SelectionBar.tsx";

const SEARCH_SHORTCUT = "/";

const ALL = "all";

type Selecting = ReadonlySet<string> | null;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function actionTarget(asset: AssetListItemData): AssetActionTarget {
  return {
    id: asset.id,
    name: asset.name,
    version: asset.current?.n ?? null,
    versionCount: asset.versionCount,
  };
}

/**
 * Navigasi URL dari ketikan di kolom cari membawa nomor urut ketikannya (`state` riwayat, dicek zod). Nomornya unik
 * untuk seluruh app (bukan per pemasangan kolom), jadi entri riwayat lama tidak pernah terbaca sebagai gema.
 */
const SearchEcho = z.object({ searchEcho: z.number().int().positive() });
let lastSearchEcho = 0;

function searchEchoOf(state: unknown): number | null {
  const parsed = SearchEcho.safeParse(state);
  return parsed.success ? parsed.data.searchEcho : null;
}

/** Lokasi router yang dibaca kolom cari: kata kunci di URL, nomor ketikan asalnya, dan kunci entri riwayat. */
type SearchLocation = Readonly<{ value: string; echo: number | null; key: string }>;

/**
 * Kolom cari dengan teks lokal: URL diperbarui setiap ketikan (`replace`), tetapi isi kolom tidak menunggu navigasi,
 * jadi kursor tidak melompat. Navigasi router tiba belakangan (transition) dan bisa dirangkum: navigasi yang belum
 * selesai dibatalkan, jadi hanya ketikan terakhir yang tiba. Setiap ketikan bernomor, dan nomornya ikut di `state`
 * navigasi: lokasi yang membawa nomor ketikan yang masih ditunggu adalah gema sendiri (diabaikan, nomor sebelumnya
 * ikut dibuang). Lokasi lain berasal dari luar (Hapus filter, tautan Gudang di rel) dan menimpa isi kolom.
 */
function GudangSearch({
  location,
  onValueChange,
  inputRef,
}: {
  location: SearchLocation;
  onValueChange: (value: string, echo: number) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [text, setText] = useState(location.value);
  const [synced, setSynced] = useState(location.key);
  const [pending, setPending] = useState<readonly number[]>([]);
  if (location.key !== synced) {
    setSynced(location.key);
    const echo = location.echo === null ? -1 : pending.indexOf(location.echo);
    if (echo === -1) {
      setPending([]);
      setText(location.value);
    } else {
      setPending(pending.slice(echo + 1));
    }
  }
  return (
    <SearchField
      ref={inputRef}
      shortcut={SEARCH_SHORTCUT}
      aria-label={t.gudang.search.label}
      placeholder={t.gudang.search.placeholder}
      maxLength={ASSET_SEARCH_MAX_CHARS}
      autoComplete="off"
      value={text}
      onChange={(event) => {
        const next = event.target.value;
        lastSearchEcho += 1;
        const echo = lastSearchEcho;
        setText(next);
        setPending((current) => [...current, echo]);
        onValueChange(next, echo);
      }}
    />
  );
}

/** Pintasan "/" ke kolom cari, kecuali saat mengetik atau berada di menu/dialog. */
function useSearchShortcut(input: React.RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== SEARCH_SHORTCUT || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      event.preventDefault();
      input.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [input]);
}

/**
 * Baris filter (FigCraft layar 03 #1295): kiri Search 320 + Dropdown Tier, Tahap, Tanggal, Urutkan (jarak 8); kanan
 * Ghost sm "Pilih" (mode pilih, `aria-pressed`) dan toggle "Tampilan" grid/daftar.
 */
function GudangFilters({
  params,
  onChange,
  search,
  status,
  selecting,
  onToggleSelecting,
  searchInput,
  selectToggle,
}: {
  params: GudangParams;
  /** `echo`: nomor ketikan kolom cari yang menghasilkan perubahan ini. */
  onChange: (next: GudangParams, echo?: number) => void;
  search: SearchLocation;
  /** Jumlah hasil untuk pembaca layar (kosong tanpa cari/filter atau selama hasil baru dimuat). */
  status: string;
  selecting: boolean;
  onToggleSelecting: () => void;
  searchInput: React.RefObject<HTMLInputElement | null>;
  selectToggle: React.RefObject<HTMLButtonElement | null>;
}) {
  const { gudang } = t;
  return (
    <section aria-label={gudang.filters} className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <GudangSearch
          location={search}
          onValueChange={(q, echo) => onChange({ ...params, q }, echo)}
          inputRef={searchInput}
        />
        <Dropdown
          prefix={gudang.tier}
          value={params.tier ?? ALL}
          options={[
            { value: ALL, label: gudang.all },
            ...TIER_IDS.map((tier) => ({ value: tier, label: t.tier[tier] })),
          ]}
          onValueChange={(tier) => onChange({ ...params, tier: tier === ALL ? undefined : tier })}
        />
        <Dropdown
          prefix={gudang.stage.label}
          value={params.stage ?? ALL}
          options={[
            { value: ALL, label: gudang.all },
            ...STAGE_FILTERS.map((stage) => ({ value: stage, label: gudang.stage[stage] })),
          ]}
          onValueChange={(stage) => onChange({ ...params, stage: stage === ALL ? undefined : stage })}
        />
        <Dropdown
          prefix={gudang.date.label}
          value={params.date ?? ALL}
          options={[
            { value: ALL, label: gudang.all },
            ...DATE_FILTERS.map((date) => ({ value: date, label: gudang.date[date] })),
          ]}
          onValueChange={(date) => onChange({ ...params, date: date === ALL ? undefined : date })}
        />
        <Dropdown
          prefix={gudang.sort.label}
          value={params.sort}
          options={ASSET_SORTS.map((sort) => ({ value: sort, label: gudang.sort[sort] }))}
          onValueChange={(sort) => onChange({ ...params, sort })}
        />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          ref={selectToggle}
          variant="ghost"
          size="sm"
          icon={SquareCheck}
          aria-pressed={selecting}
          onClick={onToggleSelecting}
          className="aria-pressed:bg-bg-active aria-pressed:text-text-primary"
        >
          {gudang.select.toggle}
        </Button>
        <Segmented<GudangView>
          variant="icons"
          label={gudang.view.label}
          value={params.view}
          onValueChange={(view) => onChange({ ...params, view })}
          options={[
            { value: "grid", label: <LayoutGrid size={16} />, name: gudang.view.grid },
            { value: "list", label: <List size={16} />, name: gudang.view.list },
          ]}
        />
      </div>
      {/* Selalu terpasang: pembaca layar baru mengumumkan isi status yang berubah, bukan status yang baru muncul. */}
      <p role="status" className="sr-only">
        {status}
      </p>
    </section>
  );
}

/** Status jumlah hasil (WCAG 4.1.3) setelah hasil untuk cari/filter yang aktif tiba. */
function resultsStatus(filtered: boolean, list: ReturnType<typeof useAssetList>): string {
  if (!filtered || list.data === undefined || list.isPlaceholderData || list.isLoadingError) return "";
  const count = list.data.assets.length;
  return count === 0 ? t.gudang.empty.noResults : t.gudang.found(formatNumber(count));
}

type ResultsProps = Readonly<{
  assets: readonly AssetListItemData[];
  view: GudangView;
  now: number;
  selected: Selecting;
  onToggle: (assetId: string) => void;
  onAction: ReturnType<typeof useAssetActions>["run"];
  linkState: unknown;
  busy: boolean;
}>;

function selectionFor(asset: AssetListItemData, selected: Selecting, onToggle: (id: string) => void) {
  if (selected === null) return undefined;
  const disabled = asset.current === null;
  return {
    selected: selected.has(asset.id) && !disabled,
    disabled,
    label: disabled ? t.gudang.select.unavailable(asset.name) : t.gudang.select.item(asset.name),
    onToggle: () => onToggle(asset.id),
  };
}

/** Gambar versi terkini; belum ada selama thumbnail-nya dibuat di latar (daftar diambil ulang setelah selesai). */
function cardImages(asset: AssetListItemData): Readonly<{ thumbnail?: string; turntable?: string }> {
  const current = asset.current;
  if (current === null || !current.thumbnail) return {};
  return { thumbnail: thumbUrl(asset.id, current.n), turntable: turntableUrl(asset.id, current.n) };
}

/** Grid kartu (layar 03): kartu 252 × 257, jarak 16, membungkus. */
function AssetGrid({ assets, now, selected, onToggle, linkState, busy }: ResultsProps) {
  return (
    <ul aria-label={t.gudang.results} aria-busy={busy} className="flex flex-wrap gap-4">
      {assets.map((asset) => {
        const selection = selectionFor(asset, selected, onToggle);
        const progress = assetProgress(asset);
        return (
          <li key={asset.id} data-asset-id={asset.id}>
            <AssetCard
              name={asset.name}
              href={`/gudang/${encodeURIComponent(asset.id)}`}
              linkState={linkState}
              {...cardImages(asset)}
              badge={assetBadge(asset)}
              tier={asset.tierId}
              time={formatRelativeTime(asset.updatedAt, now)}
              info={assetInfo(asset)}
              {...(progress === undefined ? {} : { progress })}
              {...(selection === undefined ? {} : { selection })}
            />
          </li>
        );
      })}
    </ul>
  );
}

/** Tampilan daftar (#4886): wadah `bg/panel`, garis `border/default`, radius 12; kepala lalu baris bergaris bawah. */
function AssetRows({ assets, now, selected, onToggle, onAction, linkState, busy }: ResultsProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-border-default bg-bg-panel">
      <AssetRowsHeader selecting={selected !== null} />
      <ul aria-label={t.gudang.results} aria-busy={busy}>
        {assets.map((asset) => {
          const selection = selectionFor(asset, selected, onToggle);
          return (
            <li
              key={asset.id}
              data-asset-id={asset.id}
              className="border-border-default border-b last:border-b-0"
            >
              <AssetRow
                name={asset.name}
                prompt={asset.prompt}
                href={`/gudang/${encodeURIComponent(asset.id)}`}
                linkState={linkState}
                thumbnail={cardImages(asset).thumbnail}
                tier={asset.tierId}
                badge={assetBadge(asset)}
                info={assetInfo(asset)}
                time={formatRelativeTime(asset.updatedAt, now)}
                {...(selection === undefined ? {} : { selection })}
                actions={
                  <AssetActionsMenu
                    size="sm"
                    label={t.assetActions.menuFor(asset.name)}
                    target={actionTarget(asset)}
                    onAction={onAction}
                  />
                }
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Memfokuskan tautan (atau kotak centang) aset di daftar; `false` bila asetnya tidak tampil. */
function focusAsset(assetId: string): boolean {
  const item = document.querySelector(`[data-asset-id="${CSS.escape(assetId)}"]`);
  const target = item?.querySelector<HTMLElement>('a[href], [role="checkbox"]:not(:disabled)');
  target?.focus();
  return target !== undefined && target !== null && document.activeElement === target;
}

/**
 * Gudang (FigCraft layar 03 #1295 + frame Tahap 10): topbar judul + jumlah aset + "Aset baru"; baris filter 20 px di
 * bawah topbar; grid atau daftar 22 px di bawahnya. Cari/filter/urut/tampilan di URL. Mode pilih memilih aset yang punya
 * versi untuk diunduh sebagai ZIP. State memuat, kosong ("Belum ada aset" / "Tidak ada hasil"), dan error.
 */
export function GudangPage() {
  const [search, setSearch] = useSearchParams();
  const location = useLocation();
  const params = parseGudangParams(search);
  const clock = useClock();
  // Batas "Tanggal" dihitung sekali per pilihan, supaya kunci query tidak berubah setiap render.
  const since = useMemo(() => dateSince(params.date, clock.now()), [params.date, clock]);
  const query = listQuery(params, since);
  const list = useAssetList(query);
  const now = useNow(true, 60_000);
  const searchInput = useRef<HTMLInputElement>(null);
  const selectToggle = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState<Selecting>(null);
  // Aset yang menerima fokus setelah aset di sebelahnya dihapus (fokus tidak jatuh ke `body`).
  const focusAfterDelete = useRef<string | null>(null);
  useSearchShortcut(searchInput);
  useArrivalFocus("search", searchInput);

  const actions = useAssetActions({
    focusAfterDelete: () => {
      const next = focusAfterDelete.current;
      if (next === null || !focusAsset(next)) searchInput.current?.focus();
    },
  });

  const assets = list.data?.assets ?? [];
  const runAction = (kind: AssetActionKind, target: AssetActionTarget, returnFocus?: HTMLElement | null) => {
    if (kind === "delete") {
      const index = assets.findIndex((asset) => asset.id === target.id);
      focusAfterDelete.current = assets[index + 1]?.id ?? assets[index - 1]?.id ?? null;
    }
    actions.run(kind, target, returnFocus);
  };

  const failedAt = list.isRefetchError ? list.errorUpdatedAt : 0;
  const reason = list.isRefetchError ? message(list.error) : "";
  useEffect(() => {
    if (failedAt !== 0) notify.error(t.gudang.refreshFailed, reason);
  }, [failedAt, reason]);

  const update = (next: GudangParams, echo?: number) =>
    setSearch(gudangSearch(next), {
      replace: true,
      ...(echo === undefined ? {} : { state: { searchEcho: echo } }),
    });
  const searchLocation: SearchLocation = {
    value: params.q,
    echo: searchEchoOf(location.state),
    key: location.key,
  };
  const linkState = gudangLinkState(location.search);
  const selectable = assets.filter((asset) => asset.current !== null);
  const selectedIds =
    selected === null ? [] : selectable.filter((asset) => selected.has(asset.id)).map((asset) => asset.id);

  const toggle = (assetId: string) =>
    setSelected((current) => {
      if (current === null) return current;
      const next = new Set(current);
      if (!next.delete(assetId)) next.add(assetId);
      return next;
    });

  let body: React.ReactNode;
  if (list.isPending) {
    body = (
      <p role="status" className="text-small text-text-secondary">
        {t.loading}
      </p>
    );
  } else if (list.isLoadingError) {
    body = (
      <EmptyState
        icon={RotateCcw}
        title={t.gudang.error.title}
        description={t.gudang.error.description}
        className="my-auto"
        action={
          <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
            {t.gudang.error.retry}
          </Button>
        }
      />
    );
  } else if (assets.length === 0) {
    body = hasListFilter(query) ? (
      <EmptyState
        icon={Search}
        title={t.gudang.empty.noResults}
        description={t.gudang.empty.noResultsBody}
        className="my-auto"
        action={
          <Button variant="ghost" size="sm" icon={X} onClick={() => update(clearFilters(params))}>
            {t.gudang.empty.clearFilters}
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={Package}
        title={t.gudang.empty.noAssets}
        description={t.gudang.empty.noAssetsBody}
        className="my-auto"
        action={
          <Button asChild variant="primary" size="sm" icon={Plus}>
            <Link to="/">{t.gudang.newAsset}</Link>
          </Button>
        }
      />
    );
  } else {
    const props: ResultsProps = {
      assets,
      view: params.view,
      now,
      selected,
      onToggle: toggle,
      onAction: runAction,
      linkState,
      busy: list.isPlaceholderData,
    };
    body = params.view === "grid" ? <AssetGrid {...props} /> : <AssetRows {...props} />;
  }

  return (
    <>
      <Topbar className="justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="text-heading text-text-primary">{t.gudang.title}</h1>
          {list.data === undefined ? null : (
            <span className="text-small text-text-tertiary">
              {t.gudang.count(formatNumber(list.data.total))}
            </span>
          )}
        </div>
        <Button asChild variant="primary" size="sm" icon={Plus}>
          <Link to="/">{t.gudang.newAsset}</Link>
        </Button>
      </Topbar>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* Mode pilih: ruang di bawah isi supaya bar melayang tidak menutupi baris terakhir. */}
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col gap-5.5 overflow-y-auto px-6 pt-5",
            selected === null ? "pb-6" : "pb-24",
          )}
        >
          <GudangFilters
            params={params}
            onChange={update}
            search={searchLocation}
            status={resultsStatus(hasListFilter(query), list)}
            selecting={selected !== null}
            onToggleSelecting={() => setSelected((current) => (current === null ? new Set() : null))}
            searchInput={searchInput}
            selectToggle={selectToggle}
          />
          {body}
        </div>
        {selected === null ? null : (
          <SelectionBar
            selectedIds={selectedIds}
            onSelectAll={() => setSelected(new Set(selectable.map((asset) => asset.id)))}
            onCancel={() => {
              // Tombol Batal hilang bersama bar: fokus pindah ke tombol "Pilih" yang membuka mode ini.
              setSelected(null);
              selectToggle.current?.focus();
            }}
          />
        )}
      </div>
      {actions.dialogs}
    </>
  );
}
