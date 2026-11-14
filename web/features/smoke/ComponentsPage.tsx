import {
  Archive,
  Check,
  Copy,
  Download,
  Ellipsis,
  Grid3x3,
  LayoutGrid,
  List,
  Package,
  PanelRight,
  Plus,
  Scan,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { AccountChip } from "@/components/AccountChip.tsx";
import { AssetCard } from "@/components/AssetCard.tsx";
import { AttachmentChip } from "@/components/AttachmentChip.tsx";
import { BudgetStats } from "@/components/BudgetStats.tsx";
import { EmptyState } from "@/components/EmptyState.tsx";
import { ProgressSteps } from "@/components/ProgressSteps.tsx";
import { StageStepper } from "@/components/StageStepper.tsx";
import { ThemeToggle } from "@/components/ThemeToggle.tsx";
import { TierIndicator, TierInfo, TierPicker } from "@/components/Tier.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog.tsx";
import { Dropdown } from "@/components/ui/dropdown.tsx";
import { IconButton } from "@/components/ui/icon-button.tsx";
import { Field, Input, Textarea } from "@/components/ui/input.tsx";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu.tsx";
import { Meter } from "@/components/ui/meter.tsx";
import { RadioCards } from "@/components/ui/radio-cards.tsx";
import { SearchField } from "@/components/ui/search-field.tsx";
import { Segmented } from "@/components/ui/segmented.tsx";
import { notify } from "@/components/ui/toast.tsx";
import { VersionList } from "@/components/VersionList.tsx";
import type { ShadingMode } from "@/features/viewer/materials.ts";
import { t, tSmoke } from "@/i18n/id.ts";
import { EXPORT_PRESETS, type ExportPreset } from "../../../shared/export.ts";
import { formatBytes, formatDuration, formatNumber } from "../../../shared/format.ts";
import { DEFAULT_TIERS, TIER_IDS, type TierId } from "../../../shared/limits.ts";
import petiThumb from "../../../tests/fixtures/turntables/textured-peti.thumb.webp?url";
import petiTurntable from "../../../tests/fixtures/turntables/textured-peti.turntable.webp?url";
import { Row, Section } from "./gallery-layout.tsx";
import { StudioGallery } from "./StudioGallery.tsx";

const g = tSmoke.gallery;

/** Gambar kartu "Peti harta kayu": thumbnail dan strip turntable fixture (chip "360°" tampil setelah strip dimuat). */
const PETI_IMAGES = { thumbnail: petiThumb, turntable: petiTurntable } as const;

function Buttons() {
  return (
    <Section title={g.sections.buttons}>
      {(["md", "sm"] as const).map((size) => (
        <Row key={size}>
          <Button variant="primary" size={size} icon={Plus}>
            {g.button.newAsset}
          </Button>
          <Button variant="secondary" size={size} icon={Download}>
            {g.button.download}
          </Button>
          <Button variant="ghost" size={size} icon={Check}>
            {g.button.approve}
          </Button>
          <Button variant="danger" size={size} icon={Trash2}>
            {g.button.remove}
          </Button>
          <Button variant="primary" size={size} disabled>
            {g.button.disabled}
          </Button>
          <Button variant="primary" size={size} loading>
            {g.button.saving}
          </Button>
        </Row>
      ))}
    </Section>
  );
}

function IconButtons() {
  return (
    <Section title={g.sections.iconButtons}>
      {(["md", "sm"] as const).map((size) => (
        <Row key={size}>
          <IconButton icon={Ellipsis} label={g.iconButton.more} size={size} />
          <IconButton
            icon={Grid3x3}
            label={g.iconButton.grid}
            shortcut={g.iconButton.gridShortcut}
            size={size}
            variant="secondary"
          />
          <IconButton icon={PanelRight} label={g.iconButton.panel} size={size} active aria-pressed />
          <IconButton
            icon={Scan}
            label={g.iconButton.focus}
            shortcut={g.iconButton.focusShortcut}
            size={size}
            disabled
          />
        </Row>
      ))}
    </Section>
  );
}

function Badges() {
  return (
    <Section title={g.sections.badges}>
      <Row>
        <Badge tone="neutral">{t.status.base}</Badge>
        <Badge tone="warning">{t.status.review}</Badge>
        <Badge tone="accent">{t.status.working}</Badge>
        <Badge tone="success">{t.status.done}</Badge>
        <Badge tone="danger">{t.status.failed}</Badge>
      </Row>
      <Row>
        <TierIndicator tier="ringan" className="text-text-secondary" />
        <TierIndicator tier="sedang" className="text-text-secondary" />
        <TierIndicator tier="maksimal" className="text-text-secondary" />
      </Row>
    </Section>
  );
}

function Inputs() {
  const [tier, setTier] = useState<TierId>("sedang");
  return (
    <Section title={g.sections.inputs}>
      <div className="grid max-w-180 grid-cols-2 gap-4">
        <Field id="galeri-nama" label={g.field.name}>
          {(control) => <Input {...control} placeholder={g.field.namePlaceholder} />}
        </Field>
        <Field id="galeri-nama-error" label={g.field.name} error={g.field.nameError}>
          {(control) => <Input {...control} />}
        </Field>
        <Field id="galeri-nama-kunci" label={g.field.locked} disabled>
          {(control) => <Input {...control} defaultValue={g.field.lockedValue} />}
        </Field>
        <Field id="galeri-catatan" label={g.field.note}>
          {(control) => <Textarea {...control} placeholder={g.field.notePlaceholder} />}
        </Field>
      </div>
      <TierPicker value={tier} onValueChange={setTier} />
      <TierInfo tier={tier} budget={DEFAULT_TIERS[tier]} />
      <ThemeToggle />
      <ToolbarSegmented />
    </Section>
  );
}

/** Segmented varian toolbar (mode tampilan viewer), dengan pilihan nonaktif seperti pada bentuk dasar. */
function ToolbarSegmented() {
  const [mode, setMode] = useState<ShadingMode>("clay");
  const modes = t.viewer.modes;
  return (
    <div className="w-fit rounded-[10px] border border-border-default bg-bg-panel p-1">
      <Segmented
        variant="toolbar"
        label={modes.label}
        value={mode}
        options={[
          { value: "texture", label: modes.texture, disabled: true },
          { value: "clay", label: modes.clay },
          { value: "uv", label: modes.uv },
          { value: "normal", label: modes.normal },
        ]}
        onValueChange={setMode}
      />
    </div>
  );
}

function Chips() {
  return (
    <Section title={g.sections.chips}>
      <Row>
        <AttachmentChip name={g.chips.file} meta={g.chips.fileMeta} onRemove={() => undefined} />
        <AttachmentChip name={g.chips.uploading} status="uploading" onRemove={() => undefined} />
        <AttachmentChip name={g.chips.failed} status="error" onRemove={() => undefined} />
        <AttachmentChip compact name={g.chips.compact} />
      </Row>
      <div className="w-55 rounded-[10px] border border-border-default bg-bg-elevated p-1">
        <AccountChip name={t.account.name} detail={t.account.detail} />
      </div>
    </Section>
  );
}

function Versions() {
  const [version, setVersion] = useState(2);
  return (
    <Section title={g.sections.versions}>
      <VersionList versions={g.versions} value={version} onValueChange={setVersion} className="w-62" />
    </Section>
  );
}

function Overlays() {
  return (
    <Section title={g.sections.overlays}>
      <Row>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary" icon={Trash2}>
              {g.dialog.open}
            </Button>
          </DialogTrigger>
          <DialogContent title={g.dialog.title} description={g.dialog.description}>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary">{g.dialog.cancel}</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button variant="danger" icon={Trash2}>
                  {g.dialog.confirm}
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Menu>
          <MenuTrigger asChild>
            <Button variant="secondary" icon={Ellipsis}>
              {g.menu.open}
            </Button>
          </MenuTrigger>
          <MenuContent align="start" className="w-55">
            <MenuLabel>
              <AccountChip name={t.account.name} detail={t.account.detail} />
            </MenuLabel>
            <MenuSeparator />
            <MenuItem icon={Settings}>{g.menu.settings}</MenuItem>
            <MenuItem icon={Copy}>{g.menu.duplicate}</MenuItem>
            <MenuItem icon={Download} hint={g.menu.exportHint}>
              {g.menu.export}
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={Trash2} danger>
              {g.menu.remove}
            </MenuItem>
            <MenuItem icon={Archive} disabled>
              {g.menu.archive}
            </MenuItem>
          </MenuContent>
        </Menu>
        <Button
          variant="ghost"
          onClick={() => notify.success(g.toasts.success.title, g.toasts.success.description)}
        >
          {g.toasts.success.button}
        </Button>
        <Button
          variant="ghost"
          onClick={() => notify.error(g.toasts.error.title, g.toasts.error.description)}
        >
          {g.toasts.error.button}
        </Button>
        <Button variant="ghost" onClick={() => notify.info(g.toasts.info.title, g.toasts.info.description)}>
          {g.toasts.info.button}
        </Button>
      </Row>
    </Section>
  );
}

function Progress() {
  const steps = g.progress.steps;
  return (
    <Section title={g.sections.progress}>
      <div className="flex max-w-90 flex-col gap-3">
        <ProgressSteps
          title={g.progress.running}
          meta={g.progress.runningMeta}
          steps={[
            { id: "skrip", label: steps.script, status: "done", duration: formatDuration(12_000) },
            { id: "build", label: steps.build, status: "done", duration: formatDuration(48_000) },
            { id: "optimasi", label: steps.optimize, status: "running" },
            { id: "render", label: steps.render, status: "pending" },
          ]}
        />
        <ProgressSteps
          title={g.progress.done}
          meta={g.progress.doneMeta}
          steps={[
            { id: "skrip", label: steps.script, status: "done" },
            { id: "build", label: steps.build, status: "done" },
          ]}
        />
        <ProgressSteps
          title={g.progress.failed}
          steps={[
            { id: "skrip", label: steps.script, status: "done", duration: formatDuration(10_000) },
            { id: "gagal", label: steps.failed, status: "failed" },
          ]}
        />
        <ProgressSteps
          title={g.progress.stopped}
          meta={g.progress.stoppedMeta}
          steps={[
            { id: "skrip", label: steps.script, status: "done", duration: formatDuration(12_000) },
            { id: "berhenti", label: steps.stopped, status: "stopped" },
          ]}
        />
      </div>
    </Section>
  );
}

/** Contoh angka sama dengan desain BudgetStats; teks dibentuk lewat formatter `shared/format.ts`. */
function Budget() {
  const b = t.budget;
  return (
    <Section title={g.sections.budget}>
      <div className="w-70 rounded-xl border border-border-default bg-bg-panel">
        <BudgetStats
          tier="sedang"
          meters={[
            {
              label: b.triangles,
              valueText: b.ofTarget(formatNumber(3388), formatNumber(8000)),
              ratio: 3388 / 8000,
            },
            {
              label: b.size,
              valueText: b.ofTarget(formatBytes(164_000), formatBytes(1_500_000)),
              ratio: 164_000 / 1_500_000,
            },
          ]}
          rows={[
            { label: b.vertex, value: formatNumber(1954) },
            { label: b.material, value: b.materialPending },
            {
              label: b.dimensions,
              value: b.dimensionsValue(formatNumber(0.65, 2), formatNumber(0.44, 2), formatNumber(0.53, 2)),
            },
          ]}
        />
      </div>
      <div className="flex w-70 flex-col gap-3.5 rounded-xl border border-border-default bg-bg-panel p-4">
        <Meter
          label={b.triangles}
          valueText={b.ofMax(formatNumber(10_900), formatNumber(12_000))}
          ratio={10_900 / 12_000}
          tone="warning"
        />
        <Meter
          label={b.size}
          valueText={b.ofMax(formatBytes(1_700_000), formatBytes(1_500_000))}
          ratio={1_700_000 / 1_500_000}
          tone="danger"
        />
      </div>
    </Section>
  );
}

function Cards() {
  const [working, review, done] = g.cards;
  return (
    <Section title={g.sections.cards}>
      <Row>
        {working ? (
          <AssetCard
            name={working.name}
            href="/gudang"
            badge={{ tone: "accent", label: t.status.working }}
            tier="sedang"
            time={working.time}
            info={working.info}
            progress={0.62}
          />
        ) : null}
        {review ? (
          <AssetCard
            name={review.name}
            href="/gudang"
            {...PETI_IMAGES}
            badge={{ tone: "warning", label: t.status.review }}
            tier="sedang"
            time={review.time}
            info={review.info}
          />
        ) : null}
        {done ? (
          <AssetCard
            name={done.name}
            href="/gudang"
            badge={{ tone: "success", label: t.status.done }}
            tier="maksimal"
            time={done.time}
            info={done.info}
          />
        ) : null}
      </Row>
    </Section>
  );
}

/** Mode pilih Gudang (frame Tahap 10 F): terpilih (garis aksen), belum dipilih, dan tanpa versi (nonaktif). */
function SelectCards() {
  const [working, review, done] = g.cards;
  const [selected, setSelected] = useState(true);
  const { select } = t.gudang;
  return (
    <Section title={g.sections.selectCards}>
      <Row>
        {review ? (
          <AssetCard
            name={review.name}
            href="/gudang"
            {...PETI_IMAGES}
            badge={{ tone: "warning", label: t.status.review }}
            tier="sedang"
            time={review.time}
            info={review.info}
            selection={{
              selected,
              disabled: false,
              label: select.item(review.name),
              onToggle: () => setSelected((value) => !value),
            }}
          />
        ) : null}
        {done ? (
          <AssetCard
            name={done.name}
            href="/gudang"
            badge={{ tone: "success", label: t.status.done }}
            tier="maksimal"
            time={done.time}
            info={done.info}
            selection={{
              selected: false,
              disabled: false,
              label: select.item(done.name),
              onToggle: () => undefined,
            }}
          />
        ) : null}
        {working ? (
          <AssetCard
            name={working.name}
            href="/gudang"
            badge={{ tone: "accent", label: t.status.working }}
            tier="sedang"
            time={working.time}
            info={working.info}
            progress={0.62}
            selection={{
              selected: false,
              disabled: true,
              label: select.unavailable(working.name),
              onToggle: () => undefined,
            }}
          />
        ) : null}
      </Row>
    </Section>
  );
}

/** Komponen Gudang dan dialog ekspor (frame Tahap 10): Search, Dropdown, toggle Tampilan, kotak centang, RadioCards. */
function Filters() {
  const { gudang } = t;
  const presets = t.assetActions.exportDialog.presets;
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState<"all" | TierId>("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [checked, setChecked] = useState(false);
  const [preset, setPreset] = useState<ExportPreset>("web");
  const [first, second, third] = g.cards;
  return (
    <Section title={g.sections.filters}>
      <Row>
        <SearchField
          shortcut="/"
          aria-label={gudang.search.label}
          placeholder={gudang.search.placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Dropdown
          prefix={gudang.tier}
          value={tier}
          options={[
            { value: "all", label: gudang.all },
            ...TIER_IDS.map((id) => ({ value: id, label: t.tier[id] })),
          ]}
          onValueChange={setTier}
        />
        <Segmented
          variant="icons"
          label={gudang.view.label}
          value={view}
          onValueChange={setView}
          options={[
            { value: "grid", label: <LayoutGrid size={16} />, name: gudang.view.grid },
            { value: "list", label: <List size={16} />, name: gudang.view.list },
          ]}
        />
      </Row>
      <Row>
        <Checkbox
          aria-label={gudang.select.item(first?.name ?? "")}
          checked={checked}
          onCheckedChange={(next) => setChecked(next === true)}
        />
        <Checkbox aria-label={gudang.select.item(second?.name ?? "")} checked />
        <Checkbox aria-label={gudang.select.unavailable(third?.name ?? "")} disabled />
      </Row>
      <div className="flex w-100 flex-col gap-2">
        <h3 id="galeri-format" className="text-label text-text-primary">
          {t.assetActions.exportDialog.format}
        </h3>
        <RadioCards
          labelledBy="galeri-format"
          value={preset}
          onValueChange={setPreset}
          options={EXPORT_PRESETS.map((value) => ({
            value,
            title: presets[value].title,
            description: presets[value].description,
            meta:
              value === "web"
                ? formatBytes(612_000)
                : t.assetActions.exportDialog.estimate(formatBytes(2_400_000)),
          }))}
        />
      </div>
    </Section>
  );
}

function Empty() {
  const { empty } = t.gudang;
  return (
    <Section title={g.sections.empty}>
      <div className="grid grid-cols-2 gap-6">
        <EmptyState
          icon={Package}
          headingLevel={3}
          title={empty.noAssets}
          description={empty.noAssetsBody}
          action={
            <Button variant="primary" size="sm" icon={Plus}>
              {t.gudang.newAsset}
            </Button>
          }
        />
        <EmptyState
          icon={Search}
          headingLevel={3}
          title={empty.noResults}
          description={empty.noResultsBody}
          action={
            <Button variant="ghost" size="sm" icon={X}>
              {empty.clearFilters}
            </Button>
          }
        />
      </div>
    </Section>
  );
}

/** Galeri komponen `/_komponen` (hanya mode dev dan tes): axe per komponen di kedua tema dan screenshot. */
export function ComponentsPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-300 flex-col gap-10 px-6 py-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-display text-text-primary">{g.title}</h1>
          <p className="text-body text-text-secondary">{g.description}</p>
        </header>
        <Buttons />
        <IconButtons />
        <Badges />
        <Section title={g.sections.stepper}>
          <div className="flex flex-col gap-3">
            <StageStepper stage="new" />
            <StageStepper stage="base" />
            <StageStepper stage="final" />
            <StageStepper stage="done" />
          </div>
        </Section>
        <Inputs />
        <Chips />
        <Versions />
        <Overlays />
        <Progress />
        <Budget />
        <Cards />
        <SelectCards />
        <Filters />
        <Empty />
        <StudioGallery />
      </div>
    </div>
  );
}
