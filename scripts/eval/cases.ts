/** Kasus `eval:base` (PLAN Tahap 3): 5 prompt di tier Sedang + tabel jawaban otomatis untuk AskUserQuestion. */
import type { AnswerChoice, AnswerSubmission } from "../../server/domain/answers.ts";
import type { AskQuestion } from "../../shared/agent-events.ts";

export type AnswerRule = Readonly<{ match: RegExp; answer: string }>;
export type EvalCase = Readonly<{ id: string; prompt: string; answers: readonly AnswerRule[] }>;

/** Preferensi umum: dipakai bila tidak ada aturan khusus kasus yang cocok. */
const GENERAL: readonly AnswerRule[] = [
  { match: /gaya|style/i, answer: "stylized" },
  { match: /detail|kerumitan|kompleks/i, answer: "sedang" },
];

export const BASE_CASES: readonly EvalCase[] = [
  {
    id: "peti",
    prompt:
      "Buatkan peti harta karun kayu bergaya kartun untuk game petualangan. Ukuran sekitar 80 × 50 × 55 cm, tutup melengkung, dua sabuk logam, dan gembok di depan.",
    answers: [{ match: /tutup/i, answer: "melengkung" }],
  },
  {
    id: "pistol-scifi",
    prompt:
      "Buatkan pistol sci-fi genggam untuk game shooter orang ketiga. Panjang sekitar 30 cm, bentuk tegas bersudut, dengan laras, gagang, pelatuk, dan tabung sel energi di sisi kanan.",
    answers: [{ match: /tangan|genggam|ukuran/i, answer: "satu tangan" }],
  },
  {
    id: "kursi",
    prompt:
      "Buatkan kursi makan kayu sederhana dengan sandaran berbilah vertikal. Tinggi sekitar 90 cm, tinggi dudukan 45 cm.",
    answers: [{ match: /bilah|sandaran/i, answer: "vertikal" }],
  },
  {
    id: "pohon",
    prompt:
      "Buatkan pohon stylized low-poly untuk game mobile. Tinggi sekitar 3 m, batang sedikit melengkung, dan tajuk daun dari beberapa gumpal bulat.",
    answers: [{ match: /daun|tajuk/i, answer: "gumpal bulat" }],
  },
  {
    id: "rubah",
    prompt:
      "Buatkan rubah kartun berdiri dengan empat kaki untuk game anak-anak. Tinggi sekitar 45 cm sampai ujung telinga, ekor besar mengembang, moncong runcing.",
    answers: [{ match: /pose|posisi/i, answer: "berdiri" }],
  },
];

/** Jawaban otomatis: aturan kasus → aturan umum → pilihan pertama. Label pilihan dipakai bila cocok. */
export function pickAnswers(
  questions: readonly AskQuestion[],
  rules: readonly AnswerRule[],
): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const question of questions) {
    const rule = [...rules, ...GENERAL].find((candidate) =>
      candidate.match.test(`${question.header} ${question.question}`),
    );
    const wanted = rule?.answer.toLowerCase();
    const option =
      (wanted === undefined
        ? undefined
        : question.options.find((item) => item.label.toLowerCase().includes(wanted))) ?? question.options[0];
    answers[question.question] = option?.label ?? rule?.answer ?? "Terserah Anda";
  }
  return answers;
}

/** Jawaban teks per pertanyaan → pilihan untuk `answer()`: label opsi dipilih, teks lain menjadi "Lainnya". */
export function asSubmission(
  questions: readonly AskQuestion[],
  answers: Readonly<Record<string, string>>,
): AnswerSubmission {
  const submission: Record<string, AnswerChoice> = {};
  for (const question of questions) {
    const answer = answers[question.question] ?? "";
    submission[question.question] = question.options.some((option) => option.label === answer)
      ? { selected: [answer] }
      : { selected: [], other: answer };
  }
  return submission;
}

/** Kasus `eval:texture` (PLAN Tahap 4): lanjutan bentuk dasar Tahap 3 yang disetujui + permintaan aset final. */
export type TextureCase = Readonly<{ id: string; prompt: string }>;

export const TEXTURE_CASES: readonly TextureCase[] = [
  {
    id: "peti",
    prompt:
      "Bentuk dasarnya saya setujui. Lanjutkan ke aset final bertekstur: badan dan tutup dari kayu tua berwarna hangat, sabuk dari besi gelap yang sedikit berkarat, dan gembok dari kuningan.",
  },
  {
    id: "pistol-scifi",
    prompt:
      "Bentuk dasarnya saya setujui. Lanjutkan ke aset final bertekstur: badan logam abu-abu gelap yang matte dengan panel lebih terang, gagang karet hitam, dan tabung sel energi berwarna biru terang.",
  },
  {
    id: "rubah",
    prompt:
      "Bentuk dasarnya saya setujui. Lanjutkan ke aset final bertekstur bergaya kartun: bulu oranye, moncong dan ujung ekor krem, kaki dan telinga cokelat tua.",
  },
];
