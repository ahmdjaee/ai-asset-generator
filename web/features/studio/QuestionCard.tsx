import { Check, CircleHelp, X } from "lucide-react";
import { type ComponentProps, type KeyboardEvent, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { t } from "@/i18n/id.ts";
import { cn } from "@/lib/utils.ts";
import type { AskQuestion } from "../../../shared/agent-events.ts";
import { OTHER_ANSWER_MAX_CHARS } from "../../../shared/limits.ts";
import type { AnswerPayload } from "./queries.ts";
import type { QuestionResolution } from "./thread-items.ts";

/** Pilihan pemilik untuk satu pertanyaan. `other: null` = "Lainnya" tidak dipilih. */
type Choice = Readonly<{ selected: readonly string[]; other: string | null }>;

const EMPTY_CHOICE: Choice = { selected: [], other: null };

function isAnswered(choice: Choice): boolean {
  return choice.selected.length > 0 || (choice.other !== null && choice.other.trim() !== "");
}

/** Pilihan → bentuk yang dikirim ke server (`POST /answers/:id`); "Lainnya" kosong tidak ikut. */
export function answerPayload(
  questions: readonly AskQuestion[],
  choices: Readonly<Record<string, Choice>>,
): AnswerPayload {
  return Object.fromEntries(
    questions.map((question) => {
      const choice = choices[question.question] ?? EMPTY_CHOICE;
      const other = choice.other?.trim() ?? "";
      return [question.question, { selected: choice.selected, ...(other === "" ? {} : { other }) }];
    }),
  );
}

const CARD = "flex flex-col rounded-[10px] border border-border-default bg-bg-raised p-3";

function QuestionTitle({ text, muted = false }: { text: string; muted?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <CircleHelp
        aria-hidden
        size={16}
        className={cn("shrink-0", muted ? "text-text-tertiary" : "text-accent-text")}
      />
      <span className="min-w-0 flex-1 text-label text-text-primary">{text}</span>
    </span>
  );
}

/** Tanda pilihan (FigCraft Radio #3741 / Kotak centang #3742): input asli bergaya, 16 px, garis 1,5 `text/tertiary`. */
function Mark({ multi, ...input }: { multi: boolean } & Omit<ComponentProps<"input">, "type" | "className">) {
  return (
    <span className="relative flex h-4.5 w-4 shrink-0 items-center justify-center">
      <input
        type={multi ? "checkbox" : "radio"}
        className={cn(
          "peer size-4 shrink-0 cursor-pointer appearance-none border-[1.5px] border-text-tertiary transition-colors",
          "checked:border-0 checked:bg-accent-solid",
          multi ? "rounded-sm" : "rounded-full",
        )}
        {...input}
      />
      {multi ? (
        <Check
          aria-hidden
          size={12}
          className="pointer-events-none absolute text-text-on-accent opacity-0 peer-checked:opacity-100"
        />
      ) : (
        <span
          aria-hidden
          className="pointer-events-none absolute size-1.5 rounded-full bg-text-on-accent opacity-0 peer-checked:opacity-100"
        />
      )}
    </span>
  );
}

const ROW = "flex gap-2.5 rounded-lg py-2 pr-2.5 pl-2 transition-colors hover:bg-bg-hover";

function QuestionFields({
  question,
  choice,
  onChange,
  onSubmitKey,
  disabled,
}: {
  question: AskQuestion;
  choice: Choice;
  onChange: (choice: Choice) => void;
  onSubmitKey: () => void;
  disabled: boolean;
}) {
  const id = useId();
  const otherInput = useRef<HTMLInputElement>(null);
  /**
   * Pilihan terakhir datang dari tombol panah. Panah memilih radio sambil berpindah (perilaku asli browser), jadi
   * "Lainnya" yang terpilih lewat panah tidak memindah fokus ke isiannya (WCAG 3.2.2); Tab masuk ke isian itu.
   */
  const arrowNavigation = useRef(false);
  const multi = question.multiSelect;
  const otherChecked = choice.other !== null;

  const toggle = (label: string, checked: boolean) => {
    if (!multi) {
      onChange({ selected: checked ? [label] : [], other: null });
      return;
    }
    const selected = checked
      ? [...choice.selected, label]
      : choice.selected.filter((value) => value !== label);
    onChange({ ...choice, selected });
  };
  const toggleOther = (checked: boolean) => {
    onChange(
      multi
        ? { ...choice, other: checked ? (choice.other ?? "") : null }
        : { selected: [], other: checked ? (choice.other ?? "") : null },
    );
    // Isian muncul setelah render berikutnya; fokus dipindah ke sana bila dipilih dengan klik atau Spasi.
    if (checked && !arrowNavigation.current) queueMicrotask(() => otherInput.current?.focus());
  };
  const onOtherKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onSubmitKey();
    }
  };

  return (
    <fieldset
      className="min-w-0"
      disabled={disabled}
      onKeyDown={(event) => {
        arrowNavigation.current = event.key.startsWith("Arrow");
      }}
      onPointerDown={() => {
        arrowNavigation.current = false;
      }}
    >
      {/* Legend fieldset berada di luar kotak isi flex, jadi jaraknya lewat margin, bukan gap. */}
      <legend className="mb-2.5 w-full">
        <QuestionTitle text={question.question} />
      </legend>
      <div className="flex flex-col gap-0.5">
        {question.options.map((option, index) => {
          const optionId = `${id}-${index}`;
          return (
            <label key={option.label} htmlFor={`${optionId}-input`} className={cn(ROW, "cursor-pointer")}>
              <Mark
                multi={multi}
                id={`${optionId}-input`}
                name={id}
                value={option.label}
                checked={choice.selected.includes(option.label)}
                onChange={(event) => toggle(option.label, event.target.checked)}
                aria-labelledby={`${optionId}-label`}
                aria-describedby={option.description === "" ? undefined : `${optionId}-desc`}
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span id={`${optionId}-label`} className="text-small text-text-primary">
                  {option.label}
                </span>
                {option.description === "" ? null : (
                  <span id={`${optionId}-desc`} className="text-caption text-text-tertiary">
                    {option.description}
                  </span>
                )}
              </span>
            </label>
          );
        })}
        <div className={ROW}>
          <Mark
            multi={multi}
            name={id}
            id={`${id}-other`}
            value=""
            checked={otherChecked}
            onChange={(event) => toggleOther(event.target.checked)}
            aria-labelledby={`${id}-other-label`}
            aria-describedby={otherChecked ? undefined : `${id}-other-desc`}
          />
          <div className={cn("flex min-w-0 flex-1 flex-col", otherChecked ? "gap-1.5" : "gap-0.5")}>
            <label htmlFor={`${id}-other`} className="flex cursor-pointer flex-col gap-0.5">
              <span id={`${id}-other-label`} className="text-small text-text-primary">
                {t.question.other}
              </span>
              {otherChecked ? null : (
                <span id={`${id}-other-desc`} className="text-caption text-text-tertiary">
                  {t.question.otherDescription}
                </span>
              )}
            </label>
            {otherChecked ? (
              <input
                ref={otherInput}
                type="text"
                aria-label={t.question.otherLabel(question.header)}
                maxLength={OTHER_ANSWER_MAX_CHARS}
                value={choice.other ?? ""}
                onChange={(event) => onChange({ ...choice, other: event.target.value })}
                onKeyDown={onOtherKey}
                className={cn(
                  "h-8 w-full min-w-0 rounded-lg border border-border-default bg-bg-raised px-2.5 text-small text-text-primary",
                  "placeholder:text-text-tertiary focus-visible:border-accent-ring",
                )}
              />
            ) : null}
          </div>
        </div>
      </div>
    </fieldset>
  );
}

function ResolvedCard({
  questions,
  resolution,
}: {
  questions: readonly AskQuestion[];
  resolution: QuestionResolution;
}) {
  const answers = resolution.cancelled ? null : resolution.answers;
  const cancelled = answers === null;
  return (
    <section aria-label={questions[0]?.question} className={cn(CARD, "gap-2")}>
      {questions.map((question) => {
        const answer = answers?.[question.question];
        return (
          <div key={question.question} className="flex flex-col gap-2">
            <QuestionTitle text={question.question} muted={cancelled} />
            <p className="flex items-center gap-2 pl-6 text-small text-text-secondary">
              {answer === undefined ? (
                <X aria-hidden size={14} className="shrink-0 text-text-tertiary" />
              ) : (
                <Check aria-hidden size={14} className="shrink-0 text-success-text" />
              )}
              <span className="min-w-0">{answer ?? t.question.cancelled}</span>
            </p>
          </div>
        );
      })}
    </section>
  );
}

/**
 * Kartu pertanyaan Claude (FigCraft "Tahap 9 · komponen Studio" B): lebar penuh kolom, `bg/raised`, garis
 * `border/default`, radius 10, padding 12, jarak 10.
 * - Pilih satu (radio) atau pilih banyak (kotak centang), selalu dengan "Lainnya" + isian teks.
 * - Beberapa pertanyaan: blok diulang dengan garis pemisah (jarak 12); satu tombol "Kirim jawaban" yang aktif setelah
 *   semua pertanyaan terjawab.
 * - Terjawab: pasangan judul + jawaban (centang `success`); dibatalkan: silang `text/tertiary`. Hanya event resolusi
 *   (`question_resolved`) yang menentukan keduanya: server selalu mengirimnya, juga saat Stop atau pemulihan.
 * - Belum ada resolusi tetapi tidak ditunggu (respons jawaban mendahului event resolusi, atau kartu baru sebelum event
 *   `waiting_user`): pilihan tampil terkunci.
 */
export function QuestionCard({
  questions,
  resolution,
  open,
  onSubmit,
}: {
  questions: readonly AskQuestion[];
  resolution: QuestionResolution | null;
  /** Pertanyaan masih ditunggu Claude. Tanpa ini (dan tanpa resolusi) pilihan terkunci sampai event berikutnya. */
  open: boolean;
  onSubmit: (answers: AnswerPayload) => Promise<void>;
}) {
  const [choices, setChoices] = useState<Readonly<Record<string, Choice>>>({});
  const [sending, setSending] = useState(false);
  if (resolution !== null) return <ResolvedCard questions={questions} resolution={resolution} />;

  const complete = questions.every((question) => isAnswered(choices[question.question] ?? EMPTY_CHOICE));
  const multi = questions.some((question) => question.multiSelect);
  const submit = () => {
    if (!complete || sending || !open) return;
    setSending(true);
    onSubmit(answerPayload(questions, choices)).then(
      () => setSending(false),
      () => setSending(false),
    );
  };

  return (
    <section aria-label={questions[0]?.question} className={cn(CARD, "gap-2.5")}>
      <div className="flex flex-col gap-3">
        {questions.flatMap((question, index) => [
          ...(index > 0
            ? [<div key={`${question.question}-sep`} aria-hidden className="h-px bg-border-default" />]
            : []),
          <QuestionFields
            key={question.question}
            question={question}
            choice={choices[question.question] ?? EMPTY_CHOICE}
            onChange={(choice) => setChoices((current) => ({ ...current, [question.question]: choice }))}
            onSubmitKey={submit}
            disabled={sending || !open}
          />,
        ])}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" disabled={!complete || !open} loading={sending} onClick={submit}>
          {t.question.submit}
        </Button>
        {multi ? <span className="text-caption text-text-tertiary">{t.question.multiHint}</span> : null}
      </div>
    </section>
  );
}
