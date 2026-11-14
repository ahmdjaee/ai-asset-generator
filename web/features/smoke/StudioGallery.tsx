import { Cuboid, RotateCcw } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/EmptyState.tsx";
import { Button } from "@/components/ui/button.tsx";
import { t, tSmoke } from "@/i18n/id.ts";
import type { AskQuestion } from "../../../shared/agent-events.ts";
import petiFinal from "../../../tests/fixtures/glb/textured/peti.glb?url";
import { ChangeShapeDialog } from "../studio/ChangeShapeDialog.tsx";
import { DockComposer, useComposerDraft } from "../studio/Composer.tsx";
import { Dock, type DockActions, type DockState } from "../studio/Dock.tsx";
import { QuestionCard } from "../studio/QuestionCard.tsx";
import { ConnectionStatusRegion, ReconnectNotice } from "../studio/ReconnectBanner.tsx";
import { type ThreadContext, ThreadView } from "../studio/ThreadView.tsx";
import type { ThreadItem } from "../studio/thread-items.ts";
import { DetailPanel } from "../viewer/DetailPanel.tsx";
import { Section } from "./gallery-layout.tsx";
import { sampleDetail } from "./sample-detail.ts";

const g = tSmoke.gallery;
const s = g.studio;

function question(sample: (typeof s)["style" | "parts" | "wood" | "size"], multiSelect = false): AskQuestion {
  return { question: sample.question, header: sample.header, multiSelect, options: sample.options };
}

const STYLE = question(s.style);
const PARTS = question(s.parts, true);
const WOOD = question(s.wood);
const SIZE = question(s.size);

async function ignoreAnswer(): Promise<void> {}

function ignore(): void {}

/** Kolom selebar thread Studio (400 px, isi 360 px). */
function ThreadColumn({ children, padded = false }: { children: ReactNode; padded?: boolean }) {
  return (
    <div
      className={
        padded
          ? "w-100 overflow-hidden rounded-xl border border-border-default bg-bg-panel p-5"
          : "w-100 overflow-hidden rounded-xl border border-border-default bg-bg-panel"
      }
    >
      {children}
    </div>
  );
}

function Questions() {
  return (
    <Section title={s.sections.questions}>
      <div className="flex flex-wrap items-start gap-6">
        <ThreadColumn padded>
          <QuestionCard questions={[STYLE]} resolution={null} open onSubmit={ignoreAnswer} />
        </ThreadColumn>
        <ThreadColumn padded>
          <QuestionCard questions={[PARTS]} resolution={null} open onSubmit={ignoreAnswer} />
        </ThreadColumn>
        <ThreadColumn padded>
          <QuestionCard
            questions={[WOOD]}
            resolution={{ answers: { [WOOD.question]: s.wood.options[0].label }, cancelled: false }}
            open={false}
            onSubmit={ignoreAnswer}
          />
        </ThreadColumn>
        <ThreadColumn padded>
          <QuestionCard
            questions={[SIZE]}
            resolution={{ answers: {}, cancelled: true }}
            open={false}
            onSubmit={ignoreAnswer}
          />
        </ThreadColumn>
      </div>
    </Section>
  );
}

const DOCK_ACTIONS: DockActions = {
  stop: ignore,
  approve: ignore,
  finish: ignore,
  revise: ignore,
  changeShape: ignore,
  pending: null,
};

const DOCK_STATES: readonly DockState[] = [
  { kind: "working", stage: "base", nextVersion: 2 },
  { kind: "waiting" },
  { kind: "baseReview", version: 1 },
  { kind: "finalReview", version: 1 },
  { kind: "done", version: 1 },
];

function DockCards() {
  // Giliran dimulai 72 dtk sebelum galeri dibuka (sama dengan desain), lalu terus berjalan.
  const [since] = useState(() => Date.now() - 72_000);
  return (
    <Section title={s.sections.dock}>
      <div className="flex flex-wrap items-start gap-6">
        {DOCK_STATES.map((state) => (
          <ThreadColumn key={state.kind}>
            <Dock
              state={state}
              workingSince={since}
              downloadUrl={petiFinal}
              downloadName="peti-harta-kayu-v1.glb"
              actions={DOCK_ACTIONS}
              composer={null}
            />
          </ThreadColumn>
        ))}
      </div>
    </Section>
  );
}

/** PNG 1×1 untuk thumbnail lampiran contoh. */
const PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function sampleImage(name: string, type: string): File {
  return new File([Uint8Array.from(atob(PIXEL_PNG), (char) => char.charCodeAt(0))], name, { type });
}

function Revision() {
  const draft = useComposerDraft();
  const { add, setText } = draft;
  const seeded = useRef(false);
  const [dialog, setDialog] = useState(false);
  useEffect(() => {
    // StrictMode menjalankan efek dua kali; contoh lampiran hanya ditambahkan sekali.
    if (seeded.current) return;
    seeded.current = true;
    add([sampleImage(g.chips.file, "image/jpeg")], g.chips.fileMeta);
    add([sampleImage(s.capture, "image/png")], t.composer.captureMeta(t.viewer.modes.clay, s.captureSize));
    setText(s.revisionText);
  }, [add, setText]);
  return (
    <Section title={s.sections.revision}>
      <div className="flex flex-wrap items-start gap-6">
        <div className="w-100 rounded-xl border border-border-default bg-bg-panel px-4 pt-3 pb-4">
          <DockComposer
            draft={draft}
            placeholder={t.composer.revisePlaceholder}
            disabled={false}
            sending={false}
            onSubmit={ignore}
            onCapture={ignore}
          />
        </div>
        <Button variant="secondary" icon={RotateCcw} onClick={() => setDialog(true)}>
          {s.openDialog}
        </Button>
        <ChangeShapeDialog open={dialog} onOpenChange={setDialog} version={1} onSubmit={ignoreAnswer} />
      </div>
    </Section>
  );
}

/** Jam reset batas pemakaian contoh: pukul 14.30 hari ini (sama dengan desain). */
function resetTime(): number {
  const date = new Date();
  date.setHours(14, 30, 0, 0);
  return date.getTime();
}

const THREAD_CONTEXT: ThreadContext = {
  attachmentUrl: () => "",
  builds: {},
  timings: () => null,
  nextVersion: null,
  questionOpen: false,
  onAnswer: ignoreAnswer,
};

function threadItems(): readonly ThreadItem[] {
  return [
    {
      kind: "claude",
      key: "c1",
      header: true,
      blocks: [{ kind: "thinking", key: "th1", text: s.thinking, durationMs: 12_000, live: false }],
    },
    { kind: "action", key: "a1", action: "approve", version: 1 },
    {
      kind: "claude",
      key: "c2",
      header: true,
      blocks: [
        { kind: "error", key: "e1", code: "TURN_FAILED", message: "", resetsAt: null },
        { kind: "error", key: "e2", code: "USAGE_LIMIT", message: "", resetsAt: resetTime() },
        { kind: "notice", key: "n1", text: s.notice },
        { kind: "stopped", key: "s1" },
        { kind: "thinking", key: "th2", text: "", durationMs: null, live: true },
      ],
    },
  ];
}

function ThreadBlocks() {
  const [items] = useState(threadItems);
  return (
    <Section title={s.sections.thread}>
      <div className="flex flex-wrap items-start gap-6">
        <ThreadColumn>
          <ThreadView
            items={items}
            phase="ready"
            hasMore
            loadingOlder={false}
            onLoadOlder={ignore}
            onRetry={ignore}
            context={THREAD_CONTEXT}
          />
        </ThreadColumn>
        <ThreadColumn>
          <ThreadView
            items={[]}
            phase="loading"
            hasMore={false}
            loadingOlder={false}
            onLoadOlder={ignore}
            onRetry={ignore}
            context={THREAD_CONTEXT}
          />
        </ThreadColumn>
      </div>
    </Section>
  );
}

function Detail() {
  return (
    <Section title={s.sections.detail}>
      <div className="w-70 overflow-hidden rounded-xl border border-border-default bg-bg-panel">
        <DetailPanel
          data={sampleDetail(true, ignore, {
            optimization: s.optimization,
            validation: { errors: 0, warnings: 2 },
          })}
          onCollapse={ignore}
        />
      </div>
    </Section>
  );
}

function Banner() {
  return (
    <Section title={s.sections.banner}>
      <div className="flex max-w-180 flex-col overflow-hidden rounded-xl border border-border-default">
        <ConnectionStatusRegion>
          <ReconnectNotice onReconnect={ignore} />
        </ConnectionStatusRegion>
        <div className="flex h-60 items-center justify-center bg-bg-viewport p-6">
          <EmptyState
            icon={Cuboid}
            headingLevel={3}
            title={t.session.emptyViewport.title}
            description={t.session.emptyViewport.description}
          />
        </div>
      </div>
    </Section>
  );
}

/** Komponen Studio Tahap 9 di galeri `/_komponen`, dikelompokkan seperti FigCraft "Tahap 9 · komponen Studio". */
export function StudioGallery() {
  return (
    <>
      <Questions />
      <DockCards />
      <Revision />
      <ThreadBlocks />
      <Detail />
      <Banner />
    </>
  );
}
