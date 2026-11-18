import { Bell, RotateCcw } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Topbar } from "@/app/shell/Topbar.tsx";
import { EmptyState } from "@/components/EmptyState.tsx";
import { ThemeToggle } from "@/components/ThemeToggle.tsx";
import { TierPicker } from "@/components/Tier.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Dropdown } from "@/components/ui/dropdown.tsx";
import { notify } from "@/components/ui/toast.tsx";
import { t } from "@/i18n/id.ts";
import { useAuthStatus } from "@/lib/health.ts";
import { requestNotificationPermission, useNotificationPermission } from "@/lib/notifications.ts";
import { useSaveSettings, useSettings } from "@/lib/settings.ts";
import { type AuthStatus, findModel } from "../../../shared/health.ts";
import { DEFAULT_TIERS, type TierId } from "../../../shared/limits.ts";
import { type AppSettings, EFFORT_LEVELS, type EffortLevel } from "../../../shared/settings.ts";
import { BudgetTable } from "./BudgetTable.tsx";
import { type BudgetForm, budgetForm, budgetSignature, validateBudget } from "./budget-form.ts";
import { AccountSection, RuntimeSection } from "./StatusSections.tsx";
import { SectionNote, SettingRow, SettingsSection } from "./section.tsx";

const copy = t.settings;

export type SettingsForm = Readonly<{
  model: string;
  effort: EffortLevel;
  defaultTier: TierId;
  budget: BudgetForm;
}>;

export function settingsForm(settings: AppSettings): SettingsForm {
  return {
    model: settings.model,
    effort: settings.effort,
    defaultTier: settings.defaultTier,
    budget: budgetForm(settings.tiers),
  };
}

function formSignature(form: SettingsForm): string {
  return JSON.stringify([form.model, form.effort, form.defaultTier, budgetSignature(form.budget)]);
}

type ModelChoices = Readonly<{
  options: ReadonlyArray<{ value: string; label: string }>;
  /** Pilihan yang mencakup model tersimpan (bisa alias untuk id lengkap). */
  selected: string;
  efforts: readonly EffortLevel[];
}>;

/**
 * Pilihan model dari akun (`supportedModels()`). Model tersimpan yang tidak ada di daftar (akun belum terbaca, atau model
 * lama) tetap ditampilkan dengan id-nya, supaya pengaturan tidak berubah diam-diam.
 */
export function modelChoices(auth: AuthStatus | undefined, model: string): ModelChoices {
  const models = auth?.state === "ok" ? auth.models : [];
  const options = models.map((entry) => ({ value: entry.value, label: entry.displayName }));
  const match = findModel(models, model);
  if (match === undefined)
    return { options: [{ value: model, label: model }, ...options], selected: model, efforts: EFFORT_LEVELS };
  return { options, selected: match.value, efforts: match.efforts };
}

/** Effort yang tetap berlaku setelah ganti model: sekarang bila didukung, lalu "high", lalu level tertinggi. */
export function effortFor(efforts: readonly EffortLevel[], current: EffortLevel): EffortLevel {
  if (efforts.length === 0 || efforts.includes(current)) return current;
  return efforts.includes("high") ? "high" : (efforts.at(-1) ?? current);
}

function ClaudeSection({ form, onChange }: { form: SettingsForm; onChange: (form: SettingsForm) => void }) {
  const auth = useAuthStatus();
  const choices = modelChoices(auth.data, form.model);
  const efforts = EFFORT_LEVELS.filter((level) => choices.efforts.includes(level) || level === form.effort);
  return (
    <SettingsSection title={copy.claude.title} description={copy.claude.description}>
      <div className="flex flex-wrap items-center gap-2">
        <Dropdown
          prefix={copy.claude.model}
          value={choices.selected}
          options={choices.options}
          onValueChange={(model) => {
            if (model === choices.selected) return;
            const next = modelChoices(auth.data, model);
            onChange({ ...form, model, effort: effortFor(next.efforts, form.effort) });
          }}
        />
        {choices.efforts.length === 0 ? null : (
          <Dropdown
            prefix={copy.claude.effort}
            value={form.effort}
            options={efforts.map((level) => ({ value: level, label: copy.claude.efforts[level] }))}
            onValueChange={(effort) => onChange({ ...form, effort })}
          />
        )}
      </div>
      <SectionNote>{copy.claude.note}</SectionNote>
    </SettingsSection>
  );
}

function AssetsSection({
  form,
  errors,
  onChange,
}: {
  form: SettingsForm;
  errors: ReturnType<typeof validateBudget>["errors"];
  onChange: (form: SettingsForm) => void;
}) {
  const a = copy.assets;
  return (
    <SettingsSection title={a.title} description={a.description}>
      <SettingRow label={a.defaultTier} description={a.defaultTierHint}>
        <TierPicker
          label={a.defaultTier}
          value={form.defaultTier}
          onValueChange={(defaultTier) => onChange({ ...form, defaultTier })}
        />
      </SettingRow>
      <SettingRow label={a.budget} description={a.budgetHint} divided>
        <Button
          variant="ghost"
          size="sm"
          icon={RotateCcw}
          onClick={() => onChange({ ...form, budget: budgetForm(DEFAULT_TIERS) })}
        >
          {a.restore}
        </Button>
      </SettingRow>
      <BudgetTable form={form.budget} errors={errors} onChange={(budget) => onChange({ ...form, budget })} />
      <SectionNote>{a.note}</SectionNote>
    </SettingsSection>
  );
}

function NotificationControl() {
  const permission = useNotificationPermission();
  const d = copy.display;
  switch (permission) {
    case "default":
      return (
        <Button
          variant="secondary"
          size="sm"
          icon={Bell}
          onClick={() => void requestNotificationPermission()}
        >
          {d.allow}
        </Button>
      );
    case "granted":
      return <Badge tone="success">{d.allowed}</Badge>;
    case "denied":
      return <Badge tone="danger">{d.blocked}</Badge>;
    case "unsupported":
      return <Badge tone="neutral">{d.unsupported}</Badge>;
  }
}

function DisplaySection() {
  const permission = useNotificationPermission();
  const d = copy.display;
  const description =
    permission === "denied"
      ? d.blockedDescription
      : permission === "unsupported"
        ? d.unsupportedDescription
        : d.notificationsDescription;
  return (
    <SettingsSection title={d.title}>
      <SettingRow label={d.theme} description={d.themeDescription}>
        <ThemeToggle />
      </SettingRow>
      <SettingRow label={d.notifications} description={description} divided>
        <NotificationControl />
      </SettingRow>
    </SettingsSection>
  );
}

/**
 * Bilah simpan (FigCraft "Bilah simpan"): `bg/elevated`, garis `border/strong`, radius 8, padding 10/12/10/16, jarak 8;
 * keterangan Small `text/secondary`, Ghost "Batal" dan Primary "Simpan". Menempel di bawah area gulir selama ada
 * perubahan. Saat hilang (disimpan atau dibatalkan) dengan fokus di dalamnya, fokus pindah ke area utama.
 */
function SaveBar({
  invalid,
  saving,
  onCancel,
  onSave,
}: {
  invalid: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = bar.current;
    return () => {
      if (element?.contains(document.activeElement)) element.closest<HTMLElement>("main")?.focus();
    };
  }, []);
  return (
    <div
      ref={bar}
      className="sticky bottom-4 flex items-center gap-2 rounded-lg border border-border-strong bg-bg-elevated py-2.5 pr-3 pl-4"
    >
      <p role="status" className="min-w-0 flex-1 text-small text-text-secondary">
        {invalid ? copy.save.invalid : copy.save.pending}
      </p>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        {copy.save.cancel}
      </Button>
      <Button variant="primary" size="sm" disabled={invalid} loading={saving} onClick={onSave}>
        {copy.save.save}
      </Button>
    </div>
  );
}

function SettingsForms({ settings }: { settings: AppSettings }) {
  const save = useSaveSettings();
  const saved = settingsForm(settings);
  const [edits, setEdits] = useState<SettingsForm | null>(null);
  const form = edits ?? saved;
  const validation = validateBudget(form.budget);
  const dirty = edits !== null && formSignature(edits) !== formSignature(saved);

  const submit = () => {
    if (validation.tiers === null) return;
    save.mutate(
      { model: form.model, effort: form.effort, defaultTier: form.defaultTier, tiers: validation.tiers },
      {
        onSuccess: () => {
          setEdits(null);
          notify.success(copy.save.saved);
        },
        onError: (error) => notify.error(copy.save.failed, error.message),
      },
    );
  };

  return (
    <>
      <ClaudeSection form={form} onChange={setEdits} />
      <AssetsSection form={form} errors={validation.errors} onChange={setEdits} />
      <RuntimeSection />
      <DisplaySection />
      {dirty ? (
        <SaveBar
          invalid={validation.tiers === null}
          saving={save.isPending}
          onCancel={() => setEdits(null)}
          onSave={submit}
        />
      ) : null}
    </>
  );
}

/**
 * Pengaturan (FigCraft layar 05): kolom 720 px di tengah, 32 px di bawah topbar, bagian berjarak 24. Akun dan runtime
 * dibaca terpisah dari pengaturan tersimpan, jadi tetap tampil walau salah satunya belum termuat.
 */
export function SettingsPage() {
  const settings = useSettings();
  return (
    <>
      <Topbar>
        <h1 className="text-heading text-text-primary">{copy.title}</h1>
      </Topbar>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto box-content flex w-full max-w-180 flex-col gap-6 px-6 py-8">
          <AccountSection />
          {settings.data !== undefined ? (
            <SettingsForms settings={settings.data} />
          ) : settings.isError ? (
            <EmptyState
              icon={RotateCcw}
              title={copy.error.title}
              description={copy.error.description}
              action={
                <Button variant="secondary" size="sm" onClick={() => void settings.refetch()}>
                  {copy.error.retry}
                </Button>
              }
            />
          ) : (
            <p role="status" className="text-small text-text-secondary">
              {t.loading}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
