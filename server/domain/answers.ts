/**
 * Jawaban pemilik untuk kartu pertanyaan Claude (AskUserQuestion), fungsi murni.
 *
 * UI mengirim pilihan per pertanyaan: label yang dipilih dan/atau teks "Lainnya". Claude Code menerima
 * `answers: { [teks pertanyaan]: string }`; jawaban pilih banyak digabung dengan koma (lihat `AskUserQuestionOutput`
 * di `sdk-tools.d.ts`), dan "Lainnya" berupa teks bebas.
 */
import type { AskQuestion } from "../../shared/agent-events.ts";
import { OTHER_ANSWER_MAX_CHARS } from "../../shared/limits.ts";

export type AnswerChoice = Readonly<{ selected: readonly string[]; other?: string }>;
/** Pilihan pemilik per pertanyaan, dikunci dengan teks pertanyaan. */
export type AnswerSubmission = Readonly<Record<string, AnswerChoice>>;

export type FormattedAnswers =
  | Readonly<{ ok: true; answers: Readonly<Record<string, string>> }>
  | Readonly<{ ok: false; code: "INVALID_ANSWER"; message: string }>;

/** Hasil menjawab kartu pertanyaan (runner dan service). */
export type AnswerResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: "QUESTION_NOT_FOUND" | "INVALID_ANSWER"; message: string }>;

function invalid(message: string): FormattedAnswers {
  return { ok: false, code: "INVALID_ANSWER", message };
}

function formatOne(question: AskQuestion, choice: AnswerChoice | undefined): string | FormattedAnswers {
  if (choice === undefined) return invalid(`Pertanyaan "${question.header}" belum dijawab.`);
  const labels = new Set(question.options.map((option) => option.label));
  const unknown = choice.selected.find((label) => !labels.has(label));
  if (unknown !== undefined)
    return invalid(`Pilihan "${unknown}" tidak ada di pertanyaan "${question.header}".`);
  if (new Set(choice.selected).size !== choice.selected.length) {
    return invalid(`Pilihan ganda di pertanyaan "${question.header}".`);
  }
  const other = choice.other?.trim() ?? "";
  if (other.length > OTHER_ANSWER_MAX_CHARS) {
    return invalid(`Jawaban "Lainnya" maksimal ${OTHER_ANSWER_MAX_CHARS} karakter.`);
  }
  const parts = [...choice.selected, ...(other === "" ? [] : [other])];
  if (parts.length === 0) return invalid(`Pertanyaan "${question.header}" belum dijawab.`);
  if (!question.multiSelect && parts.length > 1) {
    return invalid(`Pertanyaan "${question.header}" hanya boleh satu jawaban.`);
  }
  // Urutan pilihan mengikuti urutan opsi, supaya jawaban yang sama selalu berbunyi sama.
  const order = question.options.map((option) => option.label);
  const sorted = [...choice.selected].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return [...sorted, ...(other === "" ? [] : [other])].join(", ");
}

/** Memvalidasi pilihan pemilik terhadap pertanyaannya, lalu menyusun `answers` untuk Claude. */
export function formatAnswers(
  questions: readonly AskQuestion[],
  submission: AnswerSubmission,
): FormattedAnswers {
  const known = new Set(questions.map((question) => question.question));
  const extra = Object.keys(submission).find((key) => !known.has(key));
  if (extra !== undefined) return invalid("Jawaban untuk pertanyaan yang tidak ada.");
  const answers: Record<string, string> = {};
  for (const question of questions) {
    const formatted = formatOne(question, submission[question.question]);
    if (typeof formatted !== "string") return formatted;
    answers[question.question] = formatted;
  }
  return { ok: true, answers };
}
