import { describe, expect, test } from "bun:test";
import type { AskQuestion } from "../../shared/agent-events.ts";
import { OTHER_ANSWER_MAX_CHARS } from "../../shared/limits.ts";
import { formatAnswers } from "./answers.ts";

const STYLE: AskQuestion = {
  question: "Gaya apa yang diinginkan?",
  header: "Gaya",
  multiSelect: false,
  options: [
    { label: "Kartun", description: "bentuk sederhana" },
    { label: "Realistis", description: "proporsi nyata" },
  ],
};
const PARTS: AskQuestion = {
  question: "Bagian mana yang perlu detail?",
  header: "Detail",
  multiSelect: true,
  options: [
    { label: "Engsel", description: "" },
    { label: "Paku", description: "" },
    { label: "Gembok", description: "" },
  ],
};

describe("formatAnswers", () => {
  test("pilih satu dan pilih banyak (urutan mengikuti opsi, dipisah koma)", () => {
    expect(
      formatAnswers([STYLE, PARTS], {
        [STYLE.question]: { selected: ["Kartun"] },
        [PARTS.question]: { selected: ["Gembok", "Engsel"] },
      }),
    ).toEqual({
      ok: true,
      answers: { [STYLE.question]: "Kartun", [PARTS.question]: "Engsel, Gembok" },
    });
  });

  test("Lainnya: teks bebas, bisa digabung dengan pilihan di pilih banyak", () => {
    expect(formatAnswers([STYLE], { [STYLE.question]: { selected: [], other: "  low-poly  " } })).toEqual({
      ok: true,
      answers: { [STYLE.question]: "low-poly" },
    });
    expect(formatAnswers([PARTS], { [PARTS.question]: { selected: ["Paku"], other: "pegangan" } })).toEqual({
      ok: true,
      answers: { [PARTS.question]: "Paku, pegangan" },
    });
  });

  test("ditolak: belum dijawab, label asing, ganda, lebih dari satu di pilih satu, Lainnya terlalu panjang", () => {
    const cases = [
      [[STYLE], {}],
      [[STYLE], { [STYLE.question]: { selected: [], other: "   " } }],
      [[STYLE], { [STYLE.question]: { selected: ["Anime"] } }],
      [[PARTS], { [PARTS.question]: { selected: ["Paku", "Paku"] } }],
      [[STYLE], { [STYLE.question]: { selected: ["Kartun", "Realistis"] } }],
      [[STYLE], { [STYLE.question]: { selected: ["Kartun"], other: "juga lucu" } }],
      [[STYLE], { [STYLE.question]: { selected: [], other: "x".repeat(OTHER_ANSWER_MAX_CHARS + 1) } }],
      [[STYLE], { [STYLE.question]: { selected: ["Kartun"] }, "Pertanyaan lain?": { selected: [] } }],
    ] as const;
    for (const [questions, submission] of cases) {
      expect(formatAnswers(questions, submission)).toMatchObject({ ok: false, code: "INVALID_ANSWER" });
    }
  });
});
