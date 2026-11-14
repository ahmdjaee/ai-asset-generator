import { useId, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog.tsx";
import { Field, Input } from "@/components/ui/input.tsx";
import { t } from "@/i18n/id.ts";
import { formatNumber } from "../../../shared/format.ts";
import { ASSET_NAME_MAX_CHARS } from "../../../shared/limits.ts";
import { codePointLength } from "../../../shared/text.ts";

/** Isi dialog: dipasang ulang setiap kali dialog dibuka, jadi kolomnya selalu mulai dari nama sekarang. */
function RenameForm({
  name,
  onSubmit,
  onDone,
}: {
  name: string;
  onSubmit: (name: string) => Promise<void>;
  onDone: () => void;
}) {
  const id = useId();
  const [value, setValue] = useState(name);
  const [empty, setEmpty] = useState(false);
  const [saving, setSaving] = useState(false);
  const { renameDialog } = t.assetActions;
  // Batas per code point seperti server; `maxLength` HTML menghitung unit UTF-16 (emoji dihitung dua).
  const tooLong = codePointLength(value.trim()) > ASSET_NAME_MAX_CHARS;
  let error: string | undefined;
  if (tooLong) error = renameDialog.tooLong(formatNumber(ASSET_NAME_MAX_CHARS));
  else if (empty) error = renameDialog.empty;

  const submit = () => {
    const next = value.trim();
    if (tooLong) return;
    if (next === "") {
      setEmpty(true);
      return;
    }
    if (next === name) {
      onDone();
      return;
    }
    setSaving(true);
    onSubmit(next).then(onDone, () => setSaving(false));
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Field id={id} label={renameDialog.label} {...(error === undefined ? {} : { error })}>
        {(control) => (
          <Input
            {...control}
            value={value}
            autoComplete="off"
            onChange={(event) => {
              setValue(event.target.value);
              if (event.target.value.trim() !== "") setEmpty(false);
            }}
          />
        )}
      </Field>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">{renameDialog.cancel}</Button>
        </DialogClose>
        <Button type="submit" variant="primary" loading={saving}>
          {renameDialog.save}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Dialog "Ganti nama aset" (frame Tahap 10 D #4637): keterangan, Field "Nama aset" (fokus awal), Batal + Simpan.
 * Enter menyimpan. Nama kosong ditolak di sini dan di server; dialog tetap terbuka bila penyimpanan gagal.
 */
export function RenameDialog({
  open,
  onOpenChange,
  name,
  onSubmit,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  onSubmit: (name: string) => Promise<void>;
  /** Fokus setelah dialog ditutup (dialog ini tidak punya `Dialog.Trigger`). */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const { renameDialog } = t.assetActions;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={renameDialog.title}
        description={renameDialog.description}
        {...(onCloseAutoFocus === undefined ? {} : { onCloseAutoFocus })}
      >
        <RenameForm name={name} onSubmit={onSubmit} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
