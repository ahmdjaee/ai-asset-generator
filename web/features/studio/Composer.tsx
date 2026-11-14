import { ArrowUp, Camera, ImagePlus, LoaderCircle, Paperclip } from "lucide-react";
import {
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useDropzone } from "react-dropzone";
import { AttachmentChip } from "@/components/AttachmentChip.tsx";
import { TierPicker } from "@/components/Tier.tsx";
import { IconButton } from "@/components/ui/icon-button.tsx";
import { notify } from "@/components/ui/toast.tsx";
import { Tooltip } from "@/components/ui/tooltip.tsx";
import { t } from "@/i18n/id.ts";
import { cn } from "@/lib/utils.ts";
import type { AttachmentKind } from "../../../shared/agent-events.ts";
import { MESSAGE_MAX_CHARS, type TierId } from "../../../shared/limits.ts";
import { ACCEPT_ALL, ACCEPT_IMAGES, attachmentKind, checkFiles, fileMeta } from "./attachments.ts";

export type DraftAttachment = Readonly<{
  id: string;
  file: File;
  kind: AttachmentKind;
  meta: string;
  /** URL objek untuk thumbnail gambar; dilepas saat lampiran dihapus atau composer dilepas. */
  preview: string | null;
}>;

export type ComposerDraft = Readonly<{
  text: string;
  setText: (text: string) => void;
  attachments: readonly DraftAttachment[];
  /** Menambah file (dari pemilih, seret-lepas, tempel, atau tangkapan viewport). `meta` menggantikan keterangan bawaan. */
  add: (files: readonly File[], meta?: string) => void;
  remove: (id: string) => void;
  clear: () => void;
}>;

function previewUrl(file: File, kind: AttachmentKind): string | null {
  return kind === "image" && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null;
}

function revoke(attachments: readonly DraftAttachment[]): void {
  for (const attachment of attachments)
    if (attachment.preview !== null) URL.revokeObjectURL(attachment.preview);
}

/** Isi composer: teks dan lampiran. File yang ditolak (jenis, ukuran, jumlah) dilaporkan lewat toast. */
export function useComposerDraft(): ComposerDraft {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<readonly DraftAttachment[]>([]);
  const current = useRef(attachments);
  current.current = attachments;
  const nextId = useRef(0);

  useEffect(() => () => revoke(current.current), []);

  const add = useCallback((files: readonly File[], meta?: string) => {
    const { accepted, errors } = checkFiles(current.current.length, files);
    const [first, ...rest] = errors;
    if (first !== undefined) notify.error(first, rest.length > 0 ? rest.join(" ") : undefined);
    if (accepted.length === 0) return;
    const added = accepted.map((file): DraftAttachment => {
      const kind = attachmentKind(file.name) ?? "image";
      nextId.current += 1;
      return {
        id: `lampiran-${nextId.current}`,
        file,
        kind,
        meta: meta ?? fileMeta(file.name, file.size),
        preview: previewUrl(file, kind),
      };
    });
    setAttachments((list) => [...list, ...added]);
  }, []);

  const remove = useCallback((id: string) => {
    setAttachments((list) => {
      revoke(list.filter((attachment) => attachment.id === id));
      return list.filter((attachment) => attachment.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setText("");
    setAttachments((list) => {
      revoke(list);
      return [];
    });
  }, []);

  return { text, setText, attachments, add, remove, clear };
}

/** Isian file tersembunyi untuk tombol lampiran; tombolnya sendiri yang bisa difokus. */
function FilePicker({
  inputRef,
  accept,
  label,
  onFiles,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  accept: string;
  /** Sama dengan tombol pembukanya (input tersembunyi; nama untuk tes dan teknologi bantu). */
  label: string;
  onFiles: (files: File[]) => void;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      hidden
      multiple
      accept={accept}
      aria-label={label}
      onChange={(event) => {
        onFiles(Array.from(event.target.files ?? []));
        // Memilih file yang sama lagi (setelah dihapus) tetap memicu `change`.
        event.target.value = "";
      }}
    />
  );
}

function AttachmentList({ draft, gap }: { draft: ComposerDraft; gap: "gap-1.5" | "gap-2" }) {
  if (draft.attachments.length === 0) return null;
  return (
    <ul aria-label={t.composer.pendingAttachments} className={cn("flex flex-wrap", gap)}>
      {draft.attachments.map((attachment) => (
        <li key={attachment.id} className="max-w-full">
          <AttachmentChip
            name={attachment.file.name}
            meta={attachment.meta}
            {...(attachment.preview === null ? {} : { thumbnail: attachment.preview })}
            onRemove={() => draft.remove(attachment.id)}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * Tombol kirim (FigCraft "Kirim" #872 / #1146): `accent/solid` + `arrow-up` `text/on-accent`; nonaktif `bg/active` +
 * ikon `text/tertiary`. md 32 radius 8 (ikon 18), sm 28 radius 6 (ikon 16).
 */
function SendButton({ size, disabled, sending }: { size: "md" | "sm"; disabled: boolean; sending: boolean }) {
  const iconSize = size === "md" ? 18 : 16;
  return (
    <Tooltip label={t.composer.send}>
      <button
        type="submit"
        aria-label={t.composer.send}
        disabled={disabled || sending}
        aria-busy={sending || undefined}
        className={cn(
          "flex shrink-0 items-center justify-center bg-accent-solid text-text-on-accent transition-colors",
          "hover:bg-accent-solid-hover disabled:bg-bg-active disabled:text-text-tertiary",
          size === "md" ? "size-8 rounded-lg" : "size-7 rounded-md",
        )}
      >
        {sending ? (
          <LoaderCircle size={iconSize} className="motion-safe:animate-spin" />
        ) : (
          <ArrowUp size={iconSize} />
        )}
      </button>
    </Tooltip>
  );
}

/** Lapisan saat file diseret ke atas composer. */
function DropHint() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[inherit] border border-accent-ring border-dashed bg-bg-panel text-small text-text-secondary">
      {t.composer.dropHint}
    </div>
  );
}

type ComposerFormProps = Readonly<{
  draft: ComposerDraft;
  disabled: boolean;
  sending: boolean;
  onSubmit: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null> | undefined;
  className: string;
  children: (field: {
    textarea: Readonly<{
      ref: (element: HTMLTextAreaElement | null) => void;
      value: string;
      onChange: (event: { target: { value: string } }) => void;
      onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
      onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
      maxLength: number;
      disabled: boolean;
      readOnly: boolean;
    }>;
    canSend: boolean;
    /** Lampiran tidak bisa diubah: composer nonaktif, atau pesan sedang dikirim (draf dikosongkan setelahnya). */
    locked: boolean;
  }) => ReactNode;
}>;

/**
 * Perilaku bersama kedua composer: Enter kirim (Shift+Enter baris baru), tempel gambar, dan seret-lepas file.
 * - Teks wajib: server menolak pesan tanpa teks (`EMPTY_MESSAGE`), juga bila ada lampiran.
 * - Selama mengirim, isian hanya-baca (bukan nonaktif), supaya fokus keyboard tidak jatuh ke `<body>`. Kirim lewat
 *   tombol memindah fokus ke isian, karena tombolnya nonaktif saat draf kosong lagi.
 */
function ComposerForm({
  draft,
  disabled,
  sending,
  onSubmit,
  textareaRef,
  className,
  children,
}: ComposerFormProps) {
  const field = useRef<HTMLTextAreaElement | null>(null);
  const locked = disabled || sending;
  const canSend = !locked && draft.text.trim() !== "";
  const { getRootProps, isDragActive } = useDropzone({
    onDrop: (files) => draft.add(files),
    noClick: true,
    noKeyboard: true,
    // react-dropzone 20 ikut menangani tempel di root; tempel sudah ditangani isian teks, jadi tanpa ini gambar
    // tempelan masuk dua kali.
    noPaste: true,
    disabled: locked,
  });
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) return;
    onSubmit();
    field.current?.focus();
  };
  return (
    <form {...getRootProps({ className: cn("relative", className), onSubmit: submit })}>
      {children({
        textarea: {
          ref: (element) => {
            field.current = element;
            if (textareaRef !== undefined) textareaRef.current = element;
          },
          value: draft.text,
          onChange: (event) => draft.setText(event.target.value),
          onKeyDown: (event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            submit();
          },
          onPaste: (event) => {
            const files = Array.from(event.clipboardData.files);
            if (files.length === 0) return;
            event.preventDefault();
            if (!locked) draft.add(files);
          },
          maxLength: MESSAGE_MAX_CHARS,
          disabled,
          readOnly: sending,
        },
        canSend,
        locked,
      })}
      {isDragActive ? <DropHint /> : null}
    </form>
  );
}

const TEXTAREA =
  "w-full min-w-0 resize-none bg-transparent text-text-primary placeholder:text-text-tertiary field-sizing-content";

/**
 * Composer aset baru (FigCraft Studio · baru #816): `bg/panel`, garis `border/strong`, radius 12, padding 12, jarak 12.
 * Chip lampiran → teks Body → toolbar (klip kertas, tambah gambar, pemisah, tier | "Enter untuk kirim", Kirim).
 */
export function PromptComposer({
  draft,
  tier,
  onTierChange,
  sending,
  onSubmit,
  textareaRef,
}: {
  draft: ComposerDraft;
  tier: TierId;
  onTierChange: (tier: TierId) => void;
  sending: boolean;
  onSubmit: () => void;
  /** Chip contoh mengisi prompt lalu memindah fokus ke sini. */
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const files = useRef<HTMLInputElement>(null);
  const images = useRef<HTMLInputElement>(null);
  const hintId = useId();
  return (
    <ComposerForm
      draft={draft}
      disabled={false}
      sending={sending}
      onSubmit={onSubmit}
      textareaRef={textareaRef}
      className="flex flex-col gap-3 rounded-xl border border-border-strong bg-bg-panel p-3"
    >
      {({ textarea, canSend, locked }) => (
        <>
          <AttachmentList draft={draft} gap="gap-2" />
          <textarea
            {...textarea}
            rows={2}
            aria-label={t.studio.promptLabel}
            aria-describedby={hintId}
            placeholder={t.studio.promptPlaceholder}
            className={cn(TEXTAREA, "max-h-60 min-h-11 text-body")}
          />
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <IconButton
                icon={Paperclip}
                label={t.composer.attach}
                disabled={locked}
                onClick={() => files.current?.click()}
              />
              <IconButton
                icon={ImagePlus}
                label={t.composer.addImage}
                disabled={locked}
                onClick={() => images.current?.click()}
              />
              <span aria-hidden className="h-5 w-px shrink-0 bg-border-default" />
              <TierPicker value={tier} onValueChange={onTierChange} />
            </div>
            <div className="flex items-center gap-3">
              <span id={hintId} className="text-caption text-text-tertiary">
                {t.composer.enterHint}
              </span>
              <SendButton size="md" disabled={!canSend} sending={sending} />
            </div>
          </div>
          <FilePicker
            inputRef={files}
            accept={ACCEPT_ALL}
            label={t.composer.attach}
            onFiles={(list) => draft.add(list)}
          />
          <FilePicker
            inputRef={images}
            accept={ACCEPT_IMAGES}
            label={t.composer.addImage}
            onFiles={(list) => draft.add(list)}
          />
        </>
      )}
    </ComposerForm>
  );
}

/**
 * Composer dock (FigCraft #1130, dengan lampiran #3981): `bg/app`, garis `border/default`, radius 10, padding 6.
 * Baris: teks Small (kiri 12) + klip kertas + kamera (IconButton Ghost sm) + Kirim 28. Lampiran di atasnya, membungkus
 * dengan jarak 6. Tombol menempel ke bawah saat teks lebih dari satu baris.
 */
export function DockComposer({
  draft,
  placeholder,
  disabled,
  sending,
  onSubmit,
  onCapture,
  textareaRef,
}: {
  draft: ComposerDraft;
  placeholder: string;
  disabled: boolean;
  sending: boolean;
  onSubmit: () => void;
  /** Tombol kamera: menambahkan tangkapan viewport sebagai lampiran. Tanpa ini (belum ada versi) tombol tidak tampil. */
  onCapture?: () => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const files = useRef<HTMLInputElement>(null);
  return (
    <ComposerForm
      draft={draft}
      disabled={disabled}
      sending={sending}
      onSubmit={onSubmit}
      textareaRef={textareaRef}
      className="flex flex-col gap-1.5 rounded-[10px] border border-border-default bg-bg-app p-1.5"
    >
      {({ textarea, canSend, locked }) => (
        <>
          <AttachmentList draft={draft} gap="gap-1.5" />
          <div className="flex items-end gap-0.5 pl-1.5">
            <textarea
              {...textarea}
              rows={1}
              aria-label={t.composer.label}
              placeholder={placeholder}
              className={cn(TEXTAREA, "max-h-36 py-1.25 text-small")}
            />
            <IconButton
              size="sm"
              icon={Paperclip}
              label={t.composer.attach}
              disabled={locked}
              onClick={() => files.current?.click()}
            />
            {onCapture === undefined ? null : (
              <IconButton
                size="sm"
                icon={Camera}
                label={t.composer.capture}
                disabled={locked}
                onClick={onCapture}
              />
            )}
            <SendButton size="sm" disabled={!canSend} sending={sending} />
          </div>
          <FilePicker
            inputRef={files}
            accept={ACCEPT_ALL}
            label={t.composer.attach}
            onFiles={(list) => draft.add(list)}
          />
        </>
      )}
    </ComposerForm>
  );
}
