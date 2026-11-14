import { RotateCcw } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog.tsx";
import { Field, Textarea } from "@/components/ui/input.tsx";
import { t } from "@/i18n/id.ts";
import { MESSAGE_MAX_CHARS } from "../../../shared/limits.ts";

/**
 * Dialog "Ubah bentuk dasar?" (FigCraft #3944): keterangan, Textarea "Apa yang perlu diubah?", Batal + Ubah bentuk
 * (Primary dengan `rotate-ccw`). Teks wajib diisi; dialog tetap terbuka bila pengiriman gagal.
 */
export function ChangeShapeDialog({
  open,
  onOpenChange,
  version,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Versi bentuk dasar yang disetujui, sumber bentuk baru. */
  version: number;
  onSubmit: (text: string) => Promise<void>;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [empty, setEmpty] = useState(false);
  const [sending, setSending] = useState(false);
  const { changeShape } = t;

  const change = (next: boolean) => {
    if (!next) {
      setText("");
      setEmpty(false);
    }
    onOpenChange(next);
  };
  const submit = () => {
    const value = text.trim();
    if (value === "") {
      setEmpty(true);
      return;
    }
    setSending(true);
    onSubmit(value).then(
      () => {
        setSending(false);
        change(false);
      },
      () => setSending(false),
    );
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent title={changeShape.title} description={changeShape.description(`v${version}`)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Field id={id} label={changeShape.label} {...(empty ? { error: changeShape.empty } : {})}>
            {(control) => (
              <Textarea
                {...control}
                value={text}
                maxLength={MESSAGE_MAX_CHARS}
                placeholder={changeShape.placeholder}
                onChange={(event) => {
                  setText(event.target.value);
                  if (event.target.value.trim() !== "") setEmpty(false);
                }}
              />
            )}
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">{changeShape.cancel}</Button>
            </DialogClose>
            <Button type="submit" variant="primary" icon={RotateCcw} loading={sending}>
              {changeShape.confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
