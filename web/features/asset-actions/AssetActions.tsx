import { Box, Copy, Download, Ellipsis, Pencil, Trash2 } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { IconButton } from "@/components/ui/icon-button.tsx";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu.tsx";
import { notify } from "@/components/ui/toast.tsx";
import { t } from "@/i18n/id.ts";
import { DeleteDialog } from "./DeleteDialog.tsx";
import { ExportDialog } from "./ExportDialog.tsx";
import { useDeleteAsset, useDuplicateAsset, useRenameAsset } from "./queries.ts";
import { RenameDialog } from "./RenameDialog.tsx";

/** Aset yang dikenai aksi. */
export type AssetActionTarget = Readonly<{
  id: string;
  name: string;
  /** Versi terpilih untuk ekspor (yang sedang dilihat atau terkini); `null` = belum ada versi, Ekspor nonaktif. */
  version: number | null;
  versionCount: number;
}>;

export type AssetActionKind = "studio" | "export" | "rename" | "duplicate" | "delete";

type DialogKind = Extract<AssetActionKind, "export" | "rename" | "delete">;

type OpenDialog = Readonly<{
  kind: DialogKind;
  target: AssetActionTarget;
  open: boolean;
  /** Elemen yang menerima fokus lagi setelah dialog ditutup (tombol atau pemicu menu yang membukanya). */
  returnFocus: HTMLElement | null;
}>;

export type RunAssetAction = (
  kind: AssetActionKind,
  target: AssetActionTarget,
  returnFocus?: HTMLElement | null,
) => void;

const DIALOG_KINDS: ReadonlySet<AssetActionKind> = new Set(["export", "rename", "delete"]);

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type AssetActionsOptions = Readonly<{
  /** Setelah aset terhapus (mis. halaman detail kembali ke Gudang). */
  onDeleted?: (target: AssetActionTarget) => void;
  /**
   * Fokus setelah dialog hapus tertutup karena asetnya terhapus: pembuka dialog (menu baris aset itu) ikut hilang.
   * Tanpa ini fokus dikembalikan ke pembuka seperti biasa.
   */
  focusAfterDelete?: () => void;
}>;

export type AssetActions = Readonly<{
  run: RunAssetAction;
  /** Dialog aksi; dirender halaman di luar bagian yang bisa hilang saat aset berubah. */
  dialogs: ReactNode;
  /**
   * Aset yang sedang (atau sudah) dihapus lewat dialog di halaman ini. Halaman yang menampilkan aset itu tetap
   * menampilkan data terakhirnya sampai pindah halaman, bukan state "tidak ditemukan" di balik dialog.
   */
  deletingId: string | null;
}>;

/**
 * Aksi aset untuk satu halaman (Gudang, Detail aset, sesi Studio): satu set dialog yang dibuka untuk aset mana pun dari
 * menu "…" atau tombol. Duplikat langsung berjalan (toast hasilnya); ganti nama, ekspor, dan hapus lewat dialog.
 */
export function useAssetActions(options: AssetActionsOptions = {}): AssetActions {
  const navigate = useNavigate();
  const rename = useRenameAsset();
  const duplicate = useDuplicateAsset();
  const remove = useDeleteAsset();
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const deleted = useRef<string | null>(null);
  const { onDeleted, focusAfterDelete } = options;

  const run: RunAssetAction = (kind, target, returnFocus = null) => {
    switch (kind) {
      case "studio":
        void navigate(`/studio/${encodeURIComponent(target.id)}`);
        return;
      case "duplicate":
        void duplicate.mutateAsync(target.id).then(
          (copy) => notify.success(t.assetActions.duplicated(copy.name)),
          (error: unknown) => notify.error(t.assetActions.duplicateFailed, message(error)),
        );
        return;
      default:
        setDialog({ kind, target, open: true, returnFocus });
    }
  };

  // Target tetap disimpan saat dialog ditutup, supaya isinya tidak hilang selama animasi tutup.
  const close = (open: boolean) => {
    if (!open) setDialog((current) => (current === null ? null : { ...current, open: false }));
  };

  const submitRename = async (target: AssetActionTarget, name: string) => {
    try {
      await rename.mutateAsync({ assetId: target.id, name });
    } catch (error) {
      notify.error(t.assetActions.renameFailed, message(error));
      throw error;
    }
  };

  const confirmDelete = async (target: AssetActionTarget) => {
    setDeletingId(target.id);
    try {
      await remove.mutateAsync(target.id);
    } catch (error) {
      setDeletingId(null);
      notify.error(t.assetActions.deleteFailed, message(error));
      throw error;
    }
    deleted.current = target.id;
    notify.success(t.assetActions.deleted(target.name));
    onDeleted?.(target);
  };

  // Dialog tanpa `Dialog.Trigger`: Radix tidak tahu ke mana fokus kembali, jadi dikembalikan ke pembukanya.
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    if (dialog === null) return;
    if (dialog.kind === "delete" && deleted.current === dialog.target.id && focusAfterDelete !== undefined) {
      focusAfterDelete();
      return;
    }
    // Pembuka yang sudah tidak ada (halaman ditinggalkan setelah hapus): halaman tujuan yang memindah fokus.
    if (dialog.returnFocus?.isConnected === true) dialog.returnFocus.focus();
  };

  let dialogs: ReactNode = null;
  if (dialog !== null) {
    const { kind, target, open } = dialog;
    if (kind === "rename") {
      dialogs = (
        <RenameDialog
          open={open}
          onOpenChange={close}
          name={target.name}
          onSubmit={(name) => submitRename(target, name)}
          onCloseAutoFocus={restoreFocus}
        />
      );
    } else if (kind === "delete") {
      dialogs = (
        <DeleteDialog
          open={open}
          onOpenChange={close}
          name={target.name}
          versionCount={target.versionCount}
          onConfirm={() => confirmDelete(target)}
          onCloseAutoFocus={restoreFocus}
        />
      );
    } else if (target.version !== null) {
      dialogs = (
        <ExportDialog
          open={open}
          onOpenChange={close}
          assetId={target.id}
          assetName={target.name}
          version={target.version}
          onCloseAutoFocus={restoreFocus}
        />
      );
    }
  }
  return { run, dialogs, deletingId };
}

const ITEMS: ReadonlyArray<Readonly<{ kind: Exclude<AssetActionKind, "delete">; icon: typeof Box }>> = [
  { kind: "studio", icon: Box },
  { kind: "export", icon: Download },
  { kind: "rename", icon: Pencil },
  { kind: "duplicate", icon: Copy },
];

const LABELS: Readonly<Record<AssetActionKind, string>> = {
  studio: t.assetActions.continueInStudio,
  export: t.assetActions.export,
  rename: t.assetActions.rename,
  duplicate: t.assetActions.duplicate,
  delete: t.assetActions.delete,
};

/**
 * Menu "…" aksi aset (FigCraft "Menu aset" #4572, lebar 220): Lanjutkan di Studio, Ekspor…, Ganti nama…, Duplikat,
 * pemisah, Hapus… (bahaya). Isi penuh di baris daftar Gudang; Detail aset dan topbar Studio membuang aksi yang sudah
 * menjadi tombol (`omit`). Ekspor nonaktif bila aset belum punya versi.
 */
export function AssetActionsMenu({
  target,
  onAction,
  omit = [],
  label = t.assetActions.menu,
  size = "md",
}: {
  target: AssetActionTarget;
  onAction: RunAssetAction;
  omit?: readonly AssetActionKind[];
  /** Nama tombol dan teks tooltip. */
  label?: string;
  size?: "md" | "sm";
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  // Aksi yang membuka dialog: fokus tidak dikembalikan ke pemicu saat menu tertutup (dialog yang mengambil fokus),
  // lalu dikembalikan ke pemicu saat dialog ditutup.
  const openingDialog = useRef(false);
  const select = (kind: AssetActionKind) => {
    openingDialog.current = DIALOG_KINDS.has(kind);
    onAction(kind, target, trigger.current);
  };
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton
          ref={trigger}
          icon={Ellipsis}
          label={label}
          size={size}
          tooltipSide="bottom"
          className="data-[state=open]:bg-bg-hover data-[state=open]:text-text-primary"
        />
      </MenuTrigger>
      <MenuContent
        align="end"
        className="min-w-55"
        onCloseAutoFocus={(event) => {
          if (!openingDialog.current) return;
          openingDialog.current = false;
          event.preventDefault();
        }}
      >
        {ITEMS.filter((item) => !omit.includes(item.kind)).map((item) => (
          <MenuItem
            key={item.kind}
            icon={item.icon}
            disabled={item.kind === "export" && target.version === null}
            onSelect={() => select(item.kind)}
          >
            {LABELS[item.kind]}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem icon={Trash2} danger onSelect={() => select("delete")}>
          {LABELS.delete}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
