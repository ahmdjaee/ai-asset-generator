/** Repositori kartu pertanyaan Claude. Kartu terbuka bertahan sampai dijawab, dibatalkan, atau server restart. */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { AskQuestion } from "../../../shared/agent-events.ts";
import { questions } from "../schema.ts";
import type { Executor } from "./executor.ts";

const QuestionsPayload = z.array(
  z.object({
    question: z.string(),
    header: z.string(),
    options: z.array(z.object({ label: z.string(), description: z.string() })),
    multiSelect: z.boolean(),
  }),
);
const Answers = z.record(z.string(), z.string());

export type QuestionRecord = Readonly<{
  id: string;
  assetId: string;
  questions: readonly AskQuestion[];
  status: "open" | "answered" | "cancelled";
  answer: Readonly<Record<string, string>> | null;
  createdAt: number;
  resolvedAt: number | null;
}>;

function toRecord(row: typeof questions.$inferSelect): QuestionRecord {
  return {
    id: row.id,
    assetId: row.assetId,
    questions: QuestionsPayload.parse(row.payload),
    status: row.status,
    answer: row.answer === null ? null : Answers.parse(row.answer),
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  };
}

export function insertQuestion(
  x: Executor,
  input: { id: string; assetId: string; questions: readonly AskQuestion[]; now: number },
): void {
  x.insert(questions)
    .values({
      id: input.id,
      assetId: input.assetId,
      payload: input.questions,
      status: "open",
      createdAt: input.now,
    })
    .run();
}

export function getQuestion(x: Executor, id: string): QuestionRecord | null {
  const row = x.select().from(questions).where(eq(questions.id, id)).get();
  return row === undefined ? null : toRecord(row);
}

/** Menutup kartu yang masih terbuka. `false` bila kartu tidak ada atau sudah ditutup. */
export function resolveQuestion(
  x: Executor,
  id: string,
  outcome: { status: "answered" | "cancelled"; answer?: Readonly<Record<string, string>>; now: number },
): boolean {
  const updated = x
    .update(questions)
    .set({ status: outcome.status, answer: outcome.answer ?? null, resolvedAt: outcome.now })
    .where(and(eq(questions.id, id), eq(questions.status, "open")))
    .returning({ id: questions.id })
    .all();
  return updated.length > 0;
}

export function listOpenQuestions(x: Executor, assetId: string): QuestionRecord[] {
  return x
    .select()
    .from(questions)
    .where(and(eq(questions.assetId, assetId), eq(questions.status, "open")))
    .orderBy(questions.createdAt)
    .all()
    .map(toRecord);
}

/** Pemulihan saat start: semua kartu terbuka dibatalkan (proses Claude yang menunggu sudah mati). */
export function cancelOpenQuestions(x: Executor, now: number): Array<{ id: string; assetId: string }> {
  return x
    .update(questions)
    .set({ status: "cancelled", resolvedAt: now })
    .where(eq(questions.status, "open"))
    .returning({ id: questions.id, assetId: questions.assetId })
    .all();
}
