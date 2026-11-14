import { describe, expect, mock, test } from "bun:test";
import { act, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { t } from "@/i18n/id.ts";
import { renderUi } from "@/test-utils.tsx";
import type { AskQuestion } from "../../../shared/agent-events.ts";
import { answerPayload, QuestionCard } from "./QuestionCard.tsx";
import type { AnswerPayload } from "./queries.ts";

const HINGE: AskQuestion = {
  question: "Engsel di belakang perlu terlihat jelas?",
  header: "Engsel",
  multiSelect: false,
  options: [
    { label: "Ya, engsel besi besar", description: "Terlihat dari belakang" },
    { label: "Tidak perlu", description: "" },
  ],
};

const DETAILS: AskQuestion = {
  question: "Bagian mana yang perlu detail?",
  header: "Detail",
  multiSelect: true,
  options: [
    { label: "Gembok", description: "" },
    { label: "Strap besi", description: "" },
  ],
};

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const submitButton = () => screen.getByRole("button", { name: t.question.submit });

describe("answerPayload", () => {
  test("pilihan per pertanyaan; Lainnya dipangkas dan tidak dikirim bila kosong", () => {
    expect(
      answerPayload([HINGE, DETAILS], {
        [HINGE.question]: { selected: [], other: "  engsel kuningan  " },
        [DETAILS.question]: { selected: ["Gembok"], other: " " },
      }),
    ).toEqual({
      [HINGE.question]: { selected: [], other: "engsel kuningan" },
      [DETAILS.question]: { selected: ["Gembok"] },
    });
  });
});

describe("QuestionCard", () => {
  test("pilih satu: Kirim aktif setelah memilih; selama mengirim tombol memuat dan pilihan terkunci", async () => {
    const pending = deferred();
    const onSubmit = mock((_answers: AnswerPayload) => pending.promise);
    const { user } = renderUi(
      <QuestionCard questions={[HINGE]} resolution={null} open onSubmit={onSubmit} />,
    );
    const card = screen.getByRole("region", { name: HINGE.question });
    const yes = within(card).getByRole("radio", { name: "Ya, engsel besi besar" });
    expect(yes.getAttribute("aria-describedby")).not.toBeNull();
    expect(within(card).getByRole("radio", { name: t.question.other })).toBeDefined();
    expect(submitButton().hasAttribute("disabled")).toBe(true);
    expect(within(card).queryByText(t.question.multiHint)).toBeNull();

    await user.click(yes);
    await user.click(submitButton());
    expect(onSubmit).toHaveBeenCalledWith({ [HINGE.question]: { selected: ["Ya, engsel besi besar"] } });
    expect(submitButton().getAttribute("aria-busy")).toBe("true");
    expect(within(card).getByRole("group", { name: HINGE.question }).hasAttribute("disabled")).toBe(true);
    pending.resolve();
    await waitFor(() => expect(submitButton().getAttribute("aria-busy")).toBeNull());
  });

  test("Lainnya: isian muncul dan mendapat fokus; Enter mengirim jawaban sendiri", async () => {
    const onSubmit = mock(async (_answers: AnswerPayload) => undefined);
    const { user } = renderUi(
      <QuestionCard questions={[HINGE]} resolution={null} open onSubmit={onSubmit} />,
    );
    expect(screen.getByText(t.question.otherDescription)).toBeDefined();
    await user.click(screen.getByRole("radio", { name: t.question.other }));
    const input = screen.getByRole("textbox", { name: t.question.otherLabel("Engsel") });
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(screen.queryByText(t.question.otherDescription)).toBeNull();
    await user.type(input, "Engsel kuningan kecil{Enter}");
    expect(onSubmit).toHaveBeenCalledWith({
      [HINGE.question]: { selected: [], other: "Engsel kuningan kecil" },
    });
  });

  test("pilih banyak + dua pertanyaan: kotak centang, petunjuk, dan Kirim menunggu semua terjawab", async () => {
    const onSubmit = mock(async (_answers: AnswerPayload) => undefined);
    const { user } = renderUi(
      <QuestionCard questions={[HINGE, DETAILS]} resolution={null} open onSubmit={onSubmit} />,
    );
    expect(screen.getByText(t.question.multiHint)).toBeDefined();
    const details = screen.getByRole("group", { name: DETAILS.question });
    await user.click(within(details).getByRole("checkbox", { name: "Gembok" }));
    await user.click(within(details).getByRole("checkbox", { name: "Strap besi" }));
    expect(submitButton().hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("radio", { name: "Tidak perlu" }));
    await user.click(submitButton());
    expect(onSubmit).toHaveBeenCalledWith({
      [HINGE.question]: { selected: ["Tidak perlu"] },
      [DETAILS.question]: { selected: ["Gembok", "Strap besi"] },
    });
  });

  test("terjawab: jawaban per pertanyaan; dibatalkan: Tidak dijawab", () => {
    const { unmount } = renderUi(
      <QuestionCard
        questions={[HINGE]}
        resolution={{ answers: { [HINGE.question]: "Ya, engsel besi besar" }, cancelled: false }}
        open={false}
        onSubmit={async () => undefined}
      />,
    );
    const card = screen.getByRole("region", { name: HINGE.question });
    expect(within(card).getByText("Ya, engsel besi besar")).toBeDefined();
    expect(within(card).queryByRole("radio")).toBeNull();
    unmount();

    renderUi(
      <QuestionCard
        questions={[HINGE]}
        resolution={{ answers: {}, cancelled: true }}
        open={false}
        onSubmit={async () => undefined}
      />,
    );
    expect(screen.getByText(t.question.cancelled)).toBeDefined();
    expect(screen.queryByRole("button", { name: t.question.submit })).toBeNull();
  });

  test("tanpa resolusi dan tidak ditunggu (event belum tiba): pilihan terkunci, bukan Tidak dijawab", () => {
    renderUi(
      <QuestionCard questions={[HINGE]} resolution={null} open={false} onSubmit={async () => undefined} />,
    );
    expect(screen.queryByText(t.question.cancelled)).toBeNull();
    expect(screen.getByRole("group", { name: HINGE.question }).hasAttribute("disabled")).toBe(true);
    expect(submitButton().hasAttribute("disabled")).toBe(true);
  });

  test("respons jawaban mendahului event resolusi: jawaban tetap tampil terpilih dan terkunci", async () => {
    const { user } = renderUi(<AnsweringHarness />);
    await user.click(screen.getByRole("radio", { name: "Ya, engsel besi besar" }));
    await user.click(submitButton());
    await waitFor(() =>
      expect(screen.getByRole("group", { name: HINGE.question }).hasAttribute("disabled")).toBe(true),
    );
    expect(screen.queryByText(t.question.cancelled)).toBeNull();
    expect(screen.getByRole<HTMLInputElement>("radio", { name: "Ya, engsel besi besar" }).checked).toBe(true);
    expect(submitButton().getAttribute("aria-busy")).toBeNull();
    expect(submitButton().hasAttribute("disabled")).toBe(true);
  });

  test("panah ke Lainnya memilihnya tanpa memindah fokus (WCAG 3.2.2); Tab lalu masuk ke isiannya", async () => {
    const { user } = renderUi(
      <QuestionCard questions={[HINGE]} resolution={null} open onSubmit={async () => undefined} />,
    );
    await user.click(screen.getByRole("radio", { name: "Tidak perlu" }));
    await user.keyboard("{ArrowDown}");
    const other = screen.getByRole<HTMLInputElement>("radio", { name: t.question.other });
    expect(other.checked).toBe(true);
    expect(screen.getByRole("textbox", { name: t.question.otherLabel("Engsel") })).toBeDefined();
    await act(async () => undefined);
    expect(document.activeElement).toBe(other);
    // Panah berikutnya tetap berpindah antar-pilihan.
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole<HTMLInputElement>("radio", { name: "Tidak perlu" }).checked).toBe(true);
    expect(screen.queryByRole("textbox", { name: t.question.otherLabel("Engsel") })).toBeNull();

    await user.keyboard("{ArrowDown}");
    await act(async () => undefined);
    expect(document.activeElement).toBe(other);
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: t.question.otherLabel("Engsel") }),
    );
  });
});

/** Kartu yang ditutup (`open` false) segera setelah respons jawaban tiba, sebelum event resolusinya datang. */
function AnsweringHarness() {
  const [open, setOpen] = useState(true);
  return (
    <QuestionCard
      questions={[HINGE]}
      resolution={null}
      open={open}
      onSubmit={async () => {
        setOpen(false);
      }}
    />
  );
}
