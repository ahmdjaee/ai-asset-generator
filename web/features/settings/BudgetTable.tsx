import type { ReactNode } from "react";
import { TierIndicator } from "@/components/Tier.tsx";
import { Dropdown, type DropdownOption } from "@/components/ui/dropdown.tsx";
import { Input } from "@/components/ui/input.tsx";
import { t } from "@/i18n/id.ts";
import { TEXTURE_SIZE_OPTIONS, TIER_IDS, type TierId } from "../../../shared/limits.ts";
import {
  type BudgetForm,
  type EditableSlot,
  readField,
  type TextFieldKey,
  tidyField,
  writeField,
  writeTexture,
} from "./budget-form.ts";

const copy = t.settings.assets;

type RowKey = keyof typeof copy.rows;

/** Kolom nama baris (FigCraft "Label" 168 px): nama Small `text/primary` + satuan Caption `text/tertiary`, jarak 2. */
function RowLabel({ row }: { row: RowKey }) {
  return (
    <div className="flex w-42 shrink-0 flex-col gap-0.5">
      <span className="text-small text-text-primary">{copy.rows[row].name}</span>
      <span className="text-caption text-text-tertiary">{copy.rows[row].unit}</span>
    </div>
  );
}

function fieldId(key: TextFieldKey): string {
  return `budget-${key.replaceAll(".", "-")}`;
}

/**
 * Isian angka (FigCraft Field Default/Error tanpa label): tinggi 32, lebar mengisi sel. Pesan error Caption
 * `danger/text` di bawahnya, tidak dipotong (boleh lebih lebar dari isian, seperti desain E).
 */
function NumberField({
  fieldKey,
  label,
  form,
  error,
  onChange,
}: {
  fieldKey: TextFieldKey;
  label: string;
  form: BudgetForm;
  error: string | undefined;
  onChange: (form: BudgetForm) => void;
}) {
  const id = fieldId(fieldKey);
  const errorId = `${id}-error`;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <Input
        id={id}
        inputMode={fieldKey.includes(".webBytes.") ? "decimal" : "numeric"}
        autoComplete="off"
        aria-label={label}
        value={readField(form, fieldKey)}
        onChange={(event) => onChange(writeField(form, fieldKey, event.target.value))}
        onBlur={(event) => {
          const tidy = tidyField(fieldKey, event.target.value);
          if (tidy !== event.target.value) onChange(writeField(form, fieldKey, tidy));
        }}
        {...(error === undefined ? {} : { "aria-invalid": true, "aria-describedby": errorId })}
      />
      {error === undefined ? null : (
        <p id={errorId} className="whitespace-nowrap text-caption text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}

type TextureValue = "none" | `${number}`;

function textureOptions(optional: boolean): DropdownOption<TextureValue>[] {
  const sizes = TEXTURE_SIZE_OPTIONS.map((size) => ({ value: `${size}` as const, label: copy.px(size) }));
  return optional ? [{ value: "none", label: copy.none, muted: true }, ...sizes] : sizes;
}

/** Sel satu tier (FigCraft "Sel …"): isi mengisi lebar kolom, dua isian berjarak 6. */
function Cell({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-1 gap-1.5 pt-0.5">{children}</div>;
}

function Row({ row, children }: { row: RowKey; children: (tier: TierId) => ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <RowLabel row={row} />
      {TIER_IDS.map((tier) => (
        <Cell key={tier}>{children(tier)}</Cell>
      ))}
    </div>
  );
}

const TEXTURE_ROWS: readonly EditableSlot[] = ["baseColor", "normal", "orm", "emissive"];

/**
 * Tabel budget per tier (FigCraft layar 05 "Tabel budget"): baris kepala ("BATAS" Overline + Tier per kolom), lalu
 * segitiga, material, empat slot tekstur (Dropdown; slot opsional bisa "Tidak ada"), dan ukuran web.glb. Jarak antar
 * baris 8, kolom nama 168, kolom tier mengisi sisa lebar dengan jarak 8.
 */
export function BudgetTable({
  form,
  errors,
  onChange,
}: {
  form: BudgetForm;
  errors: ReadonlyMap<TextFieldKey, string>;
  onChange: (form: BudgetForm) => void;
}) {
  const field = (key: TextFieldKey, row: RowKey, part: "target" | "max" | null, tier: TierId) => (
    <NumberField
      key={key}
      fieldKey={key}
      label={copy.fieldLabel(copy.rows[row].name, part === null ? null : copy[part], t.tier[tier])}
      form={form}
      error={errors.get(key)}
      onChange={onChange}
    />
  );
  return (
    <div className="flex flex-col gap-2">
      <div aria-hidden className="flex items-center gap-2">
        <span className="w-42 shrink-0 text-overline text-text-tertiary uppercase">{copy.limitColumn}</span>
        {TIER_IDS.map((tier) => (
          <span key={tier} className="flex min-w-0 flex-1 text-text-secondary">
            <TierIndicator tier={tier} />
          </span>
        ))}
      </div>
      <Row row="triangles">
        {(tier) => [
          field(`${tier}.triangles.target`, "triangles", "target", tier),
          field(`${tier}.triangles.max`, "triangles", "max", tier),
        ]}
      </Row>
      <Row row="materials">{(tier) => field(`${tier}.materials`, "materials", null, tier)}</Row>
      {TEXTURE_ROWS.map((slot) => (
        <Row key={slot} row={slot}>
          {(tier) => {
            const value = form[tier].textures[slot];
            return (
              <Dropdown<TextureValue>
                label={copy.fieldLabel(copy.rows[slot].name, null, t.tier[tier])}
                value={value === null ? "none" : `${value}`}
                options={textureOptions(slot !== "baseColor")}
                onValueChange={(next) =>
                  onChange(writeTexture(form, tier, slot, next === "none" ? null : Number(next)))
                }
              />
            );
          }}
        </Row>
      ))}
      <Row row="webBytes">
        {(tier) => [
          field(`${tier}.webBytes.target`, "webBytes", "target", tier),
          field(`${tier}.webBytes.max`, "webBytes", "max", tier),
        ]}
      </Row>
    </div>
  );
}
