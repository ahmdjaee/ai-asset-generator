import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  History,
  Info,
  LoaderCircle,
  type LucideIcon,
  RotateCcw,
  Sparkles,
  Square,
  TriangleAlert,
} from "lucide-react";
import { type MouseEvent, type ReactNode, useId, useLayoutEffect, useRef, useState } from "react";
import { AttachmentChip } from "@/components/AttachmentChip.tsx";
import { BriefCard } from "@/components/BriefCard.tsx";
import { Markdown } from "@/components/Markdown.tsx";
import { Button } from "@/components/ui/button.tsx";
import { t } from "@/i18n/id.ts";
import { cn } from "@/lib/utils.ts";
import type { MessageAttachment } from "../../../shared/agent-events.ts";
import type { OwnerAction } from "../../../shared/asset-events.ts";
import { formatDuration, formatTime } from "../../../shared/format.ts";
import type { BuildTimings } from "../../../shared/version-report.ts";
import { BuildCard } from "./BuildCard.tsx";
import { QuestionCard } from "./QuestionCard.tsx";
import type { AnswerPayload } from "./queries.ts";
import type { ClaudeBlock, ThreadItem } from "./thread-items.ts";
import type { LiveBuild } from "./thread-store.ts";

/** Data yang dibutuhkan blok thread selain item itu sendiri. */
export type ThreadContext = Readonly<{
  /** URL thumbnail lampiran gambar. */
  attachmentUrl: (attachmentId: string) => string;
  builds: Readonly<Record<string, LiveBuild>>;
  timings: (version: number) => BuildTimings | null;
  /** Nomor versi berikutnya (build yang sedang berjalan). */
  nextVersion: number | null;
  /** Claude sedang menunggu jawaban kartu pertanyaan terakhir yang belum terjawab. */
  questionOpen: boolean;
  onAnswer: (questionId: string, answers: AnswerPayload) => Promise<void>;
}>;

/** Pesan pemilik (FigCraft #1040): chip lampiran ringkas di atas bubble, rata kanan. */
function OwnerMessage({
  text,
  attachments,
  context,
}: {
  text: string;
  attachments: readonly MessageAttachment[];
  context: ThreadContext;
}) {
  return (
    <article aria-label={t.thread.owner} className="flex flex-col items-end gap-2">
      {attachments.length > 0 ? (
        <ul aria-label={t.thread.attachments} className="flex max-w-full flex-wrap justify-end gap-1.5">
          {attachments.map((attachment) => (
            <li key={attachment.id} className="max-w-full">
              <AttachmentChip
                compact
                name={attachment.name}
                {...(attachment.kind === "image" ? { thumbnail: context.attachmentUrl(attachment.id) } : {})}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {text.trim() === "" ? null : (
        <p className="max-w-74 whitespace-pre-wrap break-words rounded-xl rounded-tr-sm bg-bg-raised px-3 py-2.5 text-body text-text-primary">
          {text}
        </p>
      )}
    </article>
  );
}

const ACTION_ICONS: Readonly<Record<OwnerAction, LucideIcon>> = {
  approve: Check,
  finish: Check,
  change_shape: RotateCcw,
  stop: Square,
  retry: RotateCcw,
  resume: RotateCcw,
};

function actionText(action: OwnerAction, version: number | null): string {
  const label = version === null ? null : `v${version}`;
  switch (action) {
    case "approve":
    case "finish":
      return t.thread.actions[action](label);
    default:
      return t.thread.actions[action];
  }
}

/** Baris aksi pemilik (FigCraft "Baris aksi" #4052): garis — ikon 14 + Caption `text/secondary` — garis. */
function ActionLine({ action, version }: { action: OwnerAction; version: number | null }) {
  const Glyph = ACTION_ICONS[action];
  return (
    <p className="flex items-center gap-2 text-caption text-text-secondary">
      <span aria-hidden className="h-px min-w-4 flex-1 bg-border-default" />
      <Glyph aria-hidden size={14} className="shrink-0 text-text-tertiary" />
      <span className="shrink-0">{actionText(action, version)}</span>
      <span aria-hidden className="h-px min-w-4 flex-1 bg-border-default" />
    </p>
  );
}

/** Blok berpikir (FigCraft #1055 tertutup, #4019 terbuka, #4037 berjalan). */
function ThinkingBlock({
  text,
  durationMs,
  live,
}: {
  text: string;
  durationMs: number | null;
  live: boolean;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const label = live
    ? t.thread.thinking.live
    : durationMs === null
      ? t.thread.thinking.doneUntimed
      : t.thread.thinking.done(formatDuration(durationMs));
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex w-fit items-center gap-1.5 rounded-lg border border-border-default py-1.25 pr-2.5 pl-2 text-small transition-colors hover:bg-bg-hover",
          live ? "text-text-secondary" : "text-text-tertiary",
        )}
      >
        <Brain
          aria-hidden
          size={14}
          className={cn("shrink-0", live ? "text-accent-text" : "text-text-tertiary")}
        />
        {label}
        <Chevron aria-hidden size={14} className="shrink-0 text-text-tertiary" />
      </button>
      <div
        id={bodyId}
        hidden={!open}
        className="whitespace-pre-wrap break-words border-border-default border-l-2 pl-3 text-small text-text-secondary"
      >
        {text}
      </div>
    </div>
  );
}

/**
 * Blok status berwarna (FigCraft "Blok error" #4058, "Blok batas pemakaian" #4068, "Blok belum login" di frame
 * Tahap 11 C).
 */
function Callout({
  tone,
  title,
  description,
}: {
  tone: "danger" | "warning";
  title: string;
  description: string;
}) {
  const Glyph = tone === "danger" ? CircleAlert : TriangleAlert;
  return (
    <div
      className={cn(
        "flex gap-2 rounded-lg py-2 pr-3 pl-2.5",
        tone === "danger" ? "bg-danger-soft" : "bg-warning-soft",
      )}
    >
      <span className="flex h-4.5 w-4 shrink-0 items-center justify-center">
        <Glyph
          aria-hidden
          size={16}
          className={tone === "danger" ? "text-danger-text" : "text-warning-text"}
        />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-small text-text-primary">{title}</p>
        <p className="text-caption text-text-secondary">{description}</p>
      </div>
    </div>
  );
}

function ErrorBlock({ block }: { block: Extract<ClaudeBlock, { kind: "error" }> }) {
  const { errors } = t.thread;
  if (block.code === "USAGE_LIMIT") {
    return (
      <Callout
        tone="warning"
        title={errors.usageLimit.title}
        description={
          block.resetsAt === null
            ? errors.usageLimit.unknownReset
            : errors.usageLimit.resetsAt(formatTime(block.resetsAt))
        }
      />
    );
  }
  const copy =
    block.code === "TOOL_DENIED"
      ? errors.denied
      : block.code === "AUTH_REQUIRED"
        ? errors.authRequired
        : errors.failed;
  return <Callout tone="danger" title={copy.title} description={copy.description} />;
}

/** Baris kecil berikon 14 (FigCraft "Catatan" #4079, "Dihentikan" #4087). */
function NoteLine({ icon: Glyph, text }: { icon: LucideIcon; text: string }) {
  return (
    <p className="flex gap-2 text-small text-text-secondary">
      <span className="flex h-4.5 w-3.5 shrink-0 items-center justify-center">
        <Glyph aria-hidden size={14} className="text-text-tertiary" />
      </span>
      <span className="min-w-0 break-words">{text}</span>
    </p>
  );
}

function Block({ block, context }: { block: ClaudeBlock; context: ThreadContext }): ReactNode {
  switch (block.kind) {
    case "thinking":
      return <ThinkingBlock text={block.text} durationMs={block.durationMs} live={block.live} />;
    case "text":
      return <Markdown streaming={block.live}>{block.text}</Markdown>;
    case "question":
      return (
        <QuestionCard
          questions={block.questions}
          resolution={block.resolution}
          open={context.questionOpen}
          onSubmit={(answers) => context.onAnswer(block.questionId, answers)}
        />
      );
    case "brief":
      return <BriefCard brief={block.brief} />;
    case "build":
      return (
        <BuildCard
          block={block}
          live={context.builds[block.jobId]}
          timings={block.version === null ? null : context.timings(block.version)}
          nextVersion={context.nextVersion}
        />
      );
    case "notice":
      return <NoteLine icon={Info} text={block.text} />;
    case "error":
      return <ErrorBlock block={block} />;
    case "stopped":
      return <NoteLine icon={Square} text={t.thread.stopped} />;
  }
}

/** Grup pesan Claude (FigCraft "Pesan Claude" #1044): kepala tanda Claude 22 + "Claude", blok berjarak 10. */
function ClaudeGroup({
  header,
  blocks,
  context,
  lastQuestion,
}: {
  header: boolean;
  blocks: readonly ClaudeBlock[];
  context: ThreadContext;
  lastQuestion: string | null;
}) {
  return (
    <article aria-label={t.thread.claude} className="flex min-w-0 flex-col gap-2.5">
      {header ? (
        <p className="flex items-center gap-2 text-label text-text-primary">
          <span aria-hidden className="flex size-5.5 items-center justify-center rounded-md bg-accent-soft">
            <Sparkles size={14} className="text-accent-text" />
          </span>
          {t.thread.claude}
        </p>
      ) : null}
      {blocks.map((block) => (
        <Block
          key={block.key}
          block={block}
          context={
            block.kind === "question"
              ? { ...context, questionOpen: context.questionOpen && block.questionId === lastQuestion }
              : context
          }
        />
      ))}
    </article>
  );
}

/** Jarak tepi atas `entry` dari tepi atas area gulir yang terlihat (berubah bila digulir). */
function offsetWithin(container: Element, entry: Element): number {
  return entry.getBoundingClientRect().top - container.getBoundingClientRect().top;
}

/** Pertanyaan terakhir yang belum terjawab: hanya kartu ini yang bisa dijawab saat Claude menunggu. */
function lastOpenQuestion(items: readonly ThreadItem[]): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind !== "claude") continue;
    for (let blockIndex = item.blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = item.blocks[blockIndex];
      if (block?.kind === "question") return block.resolution === null ? block.questionId : null;
    }
  }
  return null;
}

function ThreadEntry({
  item,
  context,
  lastQuestion,
}: {
  item: ThreadItem;
  context: ThreadContext;
  lastQuestion: string | null;
}): ReactNode {
  switch (item.kind) {
    case "user":
      return <OwnerMessage text={item.text} attachments={item.attachments} context={context} />;
    case "action":
      return <ActionLine action={item.action} version={item.version} />;
    case "claude":
      return (
        <ClaudeGroup
          header={item.header}
          blocks={item.blocks}
          context={context}
          lastQuestion={lastQuestion}
        />
      );
  }
}

/** Jarak dari dasar (px) yang masih dianggap "di bawah": thread ikut turun saat isi baru datang. */
const STICK_THRESHOLD = 64;

export type ThreadViewProps = Readonly<{
  items: readonly ThreadItem[];
  phase: "loading" | "ready" | "error";
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  /** Memuat ulang percakapan yang gagal dimuat. */
  onRetry: () => void;
  context: ThreadContext;
  className?: string;
}>;

/**
 * Kolom thread (FigCraft Thread #1039): padding 20, jarak 18, isi menempel ke bawah selama masih pendek. Thread ikut
 * turun saat pesan baru datang selama pemilik ada di dasar; memuat pesan lama menjaga posisi baca.
 */
export function ThreadView({
  items,
  phase,
  hasMore,
  loadingOlder,
  onLoadOlder,
  onRetry,
  context,
  className,
}: ThreadViewProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  /**
   * Entri teratas saat "Muat pesan sebelumnya" diklik, beserta jaraknya dari atas area gulir. Setelah halaman lama
   * tiba (`loadingOlder` kembali false), entri itu dikembalikan ke jarak yang sama. Pesan baru yang masuk di bawah
   * selama memuat tidak ikut dihitung.
   */
  const anchor = useRef<Readonly<{ entry: Element; offset: number }> | null>(null);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const pending = anchor.current;
    if (pending !== null) {
      if (loadingOlder) return;
      anchor.current = null;
      if (pending.entry.isConnected)
        element.scrollTop += offsetWithin(element, pending.entry) - pending.offset;
      return;
    }
    if (stick.current) element.scrollTop = element.scrollHeight;
  });

  const loadOlder = (event: MouseEvent<HTMLButtonElement>) => {
    // Tombol berada di barisnya sendiri; entri pertama tepat sesudah baris itu.
    const entry = event.currentTarget.parentElement?.nextElementSibling ?? null;
    const element = scroller.current;
    anchor.current =
      entry === null || element === null ? null : { entry, offset: offsetWithin(element, entry) };
    onLoadOlder();
  };
  const lastQuestion = lastOpenQuestion(items);

  return (
    <div
      ref={scroller}
      onScroll={(event) => {
        const element = event.currentTarget;
        stick.current = element.scrollHeight - element.scrollTop - element.clientHeight <= STICK_THRESHOLD;
      }}
      className={cn("flex min-h-0 flex-col overflow-y-auto p-5", className)}
    >
      {/* Isi menempel ke bawah: ruang kosong di atas, bukan justify-end (yang membuat bagian atas tidak bisa digulir). */}
      <div className="mt-auto flex flex-col gap-4.5">
        {phase === "loading" ? (
          <p className="flex items-center justify-center gap-2 py-6 text-small text-text-secondary">
            <LoaderCircle
              aria-hidden
              size={16}
              className="shrink-0 text-accent-text motion-safe:animate-spin"
            />
            {t.thread.loading}
          </p>
        ) : null}
        {phase === "error" ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <p className="text-small text-text-secondary">{t.thread.error}</p>
            <Button variant="secondary" size="sm" icon={RotateCcw} onClick={onRetry}>
              {t.thread.retry}
            </Button>
          </div>
        ) : null}
        {phase === "ready" && hasMore ? (
          <div className="flex justify-center">
            <Button variant="ghost" size="sm" icon={History} loading={loadingOlder} onClick={loadOlder}>
              {t.thread.loadOlder}
            </Button>
          </div>
        ) : null}
        {items.map((item) => (
          <ThreadEntry key={item.key} item={item} context={context} lastQuestion={lastQuestion} />
        ))}
      </div>
    </div>
  );
}
