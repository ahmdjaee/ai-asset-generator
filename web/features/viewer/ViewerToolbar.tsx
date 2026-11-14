import {
  Camera,
  ChevronDown,
  Grid3x3,
  Maximize2,
  Minimize2,
  Rotate3d,
  Scan,
  Sun,
  Triangle,
} from "lucide-react";
import { Fragment, type Ref, useState } from "react";
import { IconButton } from "@/components/ui/icon-button.tsx";
import {
  Menu,
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu.tsx";
import { Segmented, type SegmentedOption } from "@/components/ui/segmented.tsx";
import { Tooltip } from "@/components/ui/tooltip.tsx";
import { t } from "@/i18n/id.ts";
import { cn } from "@/lib/utils.ts";
import { Axis3dIcon } from "./icons.ts";
import type { ShadingMode } from "./materials.ts";
import { PRESET_IDS, type PresetId } from "./math.ts";
import { VIEWER_SHORTCUTS } from "./shortcuts.ts";
import type { ViewerSettings } from "./ViewerScene.tsx";

const MODE_LABEL: Readonly<Record<ShadingMode, string>> = {
  texture: t.viewer.modes.texture,
  clay: t.viewer.modes.clay,
  uv: t.viewer.modes.uv,
  normal: t.viewer.modes.normal,
};

/** Kelompok menu Sudut sesuai desain: 3/4 | Depan, Belakang, Kiri, Kanan | Atas, Bawah. */
const PRESET_GROUPS: ReadonlyArray<readonly PresetId[]> = [
  ["iso"],
  ["front", "back", "left", "right"],
  ["top", "bottom"],
];

function Divider() {
  return <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border-default" />;
}

export type ToolbarAvailability = Readonly<{
  /** Model punya material sendiri (aset final): mode Tekstur aktif. */
  texture: boolean;
  /** Semua mesh punya UV: mode UV aktif. */
  uv: boolean;
  /** Sistem meminta animasi dikurangi: putar otomatis tidak tersedia. */
  reducedMotion: boolean;
}>;

/**
 * Toolbar viewport (FigCraft #1152): `bg/panel`, garis `border/default`, radius 10, padding 4, jarak 4, tinggi 38.
 * Urutan: mode | Wireframe, Grid, Cahaya ikut kamera | Putar otomatis, Sudut | Fokus, Ambil gambar, Layar penuh.
 * Membungkus ke baris berikutnya bila viewer lebih sempit daripada toolbar (lebarnya dibatasi pemakai).
 */
export function ViewerToolbar({
  settings,
  availability,
  fullscreen,
  onSettingsChange,
  onPreset,
  currentPreset,
  onFocus,
  onCapture,
  onFullscreen,
  className,
  ref,
}: {
  settings: ViewerSettings;
  availability: ToolbarAvailability;
  fullscreen: boolean;
  onSettingsChange: (patch: Partial<ViewerSettings>) => void;
  onPreset: (preset: PresetId) => void;
  /** Sudut cepat yang sedang dipakai kamera, dibaca saat menu Sudut dibuka. */
  currentPreset: () => PresetId | null;
  onFocus: () => void;
  onCapture: () => void;
  onFullscreen: () => void;
  className?: string;
  ref?: Ref<HTMLFieldSetElement>;
}) {
  const [menuPreset, setMenuPreset] = useState<PresetId | null>(null);
  const modeOptions: SegmentedOption<ShadingMode>[] = [
    { value: "texture", label: MODE_LABEL.texture, disabled: !availability.texture },
    { value: "clay", label: MODE_LABEL.clay },
    { value: "uv", label: MODE_LABEL.uv, disabled: !availability.uv },
    { value: "normal", label: MODE_LABEL.normal },
  ];
  const toggle = (key: "wireframe" | "grid" | "lightFollowsCamera") => () =>
    onSettingsChange({ [key]: !settings[key] });
  const spinBlocked = availability.reducedMotion;

  return (
    <fieldset
      ref={ref}
      aria-label={t.viewer.toolbar}
      className={cn(
        "flex w-fit flex-wrap items-center gap-1 rounded-[10px] border border-border-default bg-bg-panel p-1",
        className,
      )}
    >
      <Segmented
        variant="toolbar"
        label={t.viewer.modes.label}
        value={settings.mode}
        options={modeOptions}
        onValueChange={(mode) => onSettingsChange({ mode })}
      />
      <Divider />
      <IconButton
        size="sm"
        icon={Triangle}
        label={t.viewer.wireframe}
        shortcut={VIEWER_SHORTCUTS.wireframe}
        aria-pressed={settings.wireframe}
        active={settings.wireframe}
        tooltipSide="bottom"
        onClick={toggle("wireframe")}
      />
      <IconButton
        size="sm"
        icon={Grid3x3}
        label={t.viewer.grid}
        shortcut={VIEWER_SHORTCUTS.grid}
        aria-pressed={settings.grid}
        active={settings.grid}
        tooltipSide="bottom"
        onClick={toggle("grid")}
      />
      <IconButton
        size="sm"
        icon={Sun}
        label={t.viewer.light}
        shortcut={VIEWER_SHORTCUTS.light}
        aria-pressed={settings.lightFollowsCamera}
        active={settings.lightFollowsCamera}
        tooltipSide="bottom"
        onClick={toggle("lightFollowsCamera")}
      />
      <Divider />
      <IconButton
        size="sm"
        icon={Rotate3d}
        // Saat animasi dikurangi, tombol tetap bisa difokus supaya alasannya terbaca (tooltip dan nama).
        label={spinBlocked ? t.viewer.autoRotateReduced : t.viewer.autoRotate}
        {...(spinBlocked ? {} : { shortcut: VIEWER_SHORTCUTS.spin })}
        aria-pressed={settings.autoRotate}
        aria-disabled={spinBlocked || undefined}
        active={settings.autoRotate}
        tooltipSide="bottom"
        className={cn(spinBlocked && "opacity-45 hover:bg-transparent hover:text-text-secondary")}
        onClick={() => {
          if (!spinBlocked) onSettingsChange({ autoRotate: !settings.autoRotate });
        }}
      />
      <Menu
        onOpenChange={(open) => {
          if (open) setMenuPreset(currentPreset());
        }}
      >
        <Tooltip label={t.viewer.angle.tooltip} side="bottom">
          <MenuTrigger
            aria-label={t.viewer.angle.tooltip}
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md pr-1.5 pl-1 text-label text-text-secondary transition-colors",
              "hover:bg-bg-hover hover:text-text-primary focus-visible:outline-offset-1",
              "data-[state=open]:bg-bg-hover data-[state=open]:text-text-primary",
            )}
          >
            <Axis3dIcon size={20} className="shrink-0" />
            <span>{t.viewer.angle.trigger}</span>
            <ChevronDown size={16} className="shrink-0" />
          </MenuTrigger>
        </Tooltip>
        {/* Desain: menu 6 px di bawah toolbar (bukan di bawah tombol), rata kiri dengan tombol Sudut. */}
        <MenuContent align="start" sideOffset={11}>
          <MenuRadioGroup
            value={menuPreset ?? ""}
            onValueChange={(value) => {
              const preset = PRESET_IDS.find((id) => id === value);
              if (preset) onPreset(preset);
            }}
          >
            {PRESET_GROUPS.map((group, index) => (
              <Fragment key={group.join("-")}>
                {index > 0 ? <MenuSeparator /> : null}
                {group.map((id) => (
                  <MenuRadioItem
                    key={id}
                    value={id}
                    {...(id === "iso" ? { hint: t.viewer.angle.defaultHint } : {})}
                  >
                    {t.viewer.angle.presets[id]}
                  </MenuRadioItem>
                ))}
              </Fragment>
            ))}
          </MenuRadioGroup>
        </MenuContent>
      </Menu>
      <Divider />
      <IconButton
        size="sm"
        icon={Scan}
        label={t.viewer.focus}
        shortcut={VIEWER_SHORTCUTS.focus}
        tooltipSide="bottom"
        onClick={onFocus}
      />
      <IconButton size="sm" icon={Camera} label={t.viewer.capture} tooltipSide="bottom" onClick={onCapture} />
      <IconButton
        size="sm"
        icon={fullscreen ? Minimize2 : Maximize2}
        label={fullscreen ? t.viewer.exitFullscreen : t.viewer.fullscreen}
        tooltipSide="bottom"
        onClick={onFullscreen}
      />
    </fieldset>
  );
}
