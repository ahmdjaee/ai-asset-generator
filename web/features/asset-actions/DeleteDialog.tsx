import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog.tsx";
import { t } from "@/i18n/id.ts";
import { formatNumber } from "../../../shared/format.ts";

function ConfirmActions({ onConfirm, onDone }: { onConfirm: () => Promise<void>; onDone: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const { deleteDialog } = t.assetActions;
  return (
    <DialogFooter>
      <DialogClose asChild>
        <Button variant="secondary">{deleteDialog.cancel}</Button>
      </DialogClose>
      <Button
        variant="danger"
        icon={Trash2}
        loading={deleting}
        onClick={() => {
          setDeleting(true);
          onConfirm().then(onDone, () => setDeleting(false));
        }}
      >
        {deleteDialog.confirm}
      </Button>
    </DialogFooter>
  );
}

/**
 * Dialog "Hapus aset ini?" (frame Tahap 10 E #4672): nama aset, jumlah versi, dan akibatnya; Batal (fokus awal) +
 * Danger "Hapus aset". Dialog tetap terbuka bila penghapusan gagal.
 */
export function DeleteDialog({
  open,
  onOpenChange,
  name,
  versionCount,
  onConfirm,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  versionCount: number;
  onConfirm: () => Promise<void>;
  /** Fokus setelah dialog ditutup (dialog ini tidak punya `Dialog.Trigger`). */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const { deleteDialog } = t.assetActions;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        {...(onCloseAutoFocus === undefined ? {} : { onCloseAutoFocus })}
        title={deleteDialog.title}
        description={
          versionCount > 0
            ? deleteDialog.description(name, deleteDialog.versions(formatNumber(versionCount)))
            : deleteDialog.descriptionNoVersions(name)
        }
      >
        <ConfirmActions onConfirm={onConfirm} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
