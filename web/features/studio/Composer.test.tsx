import { describe, expect, mock, test } from "bun:test";
import { act, createEvent, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { Toaster } from "@/components/ui/toast.tsx";
import { t } from "@/i18n/id.ts";
import { renderUi } from "@/test-utils.tsx";
import { ATTACHMENT_MAX_FILES, type TierId } from "../../../shared/limits.ts";
import { type ComposerDraft, DockComposer, PromptComposer, useComposerDraft } from "./Composer.tsx";

type Sent = Readonly<{ text: string; files: readonly string[] }>;

function snapshot(draft: ComposerDraft): Sent {
  return { text: draft.text, files: draft.attachments.map((attachment) => attachment.file.name) };
}

function DockHarness({
  onSend,
  disabled = false,
  onCapture,
}: {
  onSend: (sent: Sent) => void;
  disabled?: boolean;
  onCapture?: () => void;
}) {
  const draft = useComposerDraft();
  return (
    <DockComposer
      draft={draft}
      placeholder={t.composer.revisePlaceholder}
      disabled={disabled}
      sending={false}
      onSubmit={() => onSend(snapshot(draft))}
      {...(onCapture === undefined ? {} : { onCapture })}
    />
  );
}

/** Composer dock yang benar-benar mengirim: `sending` aktif sampai tes memanggil `finish` (draf lalu dikosongkan). */
function SendingHarness({ onSend }: { onSend: (finish: () => void) => void }) {
  const draft = useComposerDraft();
  const [sending, setSending] = useState(false);
  return (
    <DockComposer
      draft={draft}
      placeholder={t.composer.revisePlaceholder}
      disabled={false}
      sending={sending}
      onSubmit={() => {
        setSending(true);
        onSend(() => {
          setSending(false);
          draft.clear();
        });
      }}
    />
  );
}

function PromptHarness({ onSend }: { onSend: (sent: Sent & { tier: TierId }) => void }) {
  const draft = useComposerDraft();
  const [tier, setTier] = useState<TierId>("sedang");
  return (
    <PromptComposer
      draft={draft}
      tier={tier}
      onTierChange={setTier}
      sending={false}
      onSubmit={() => onSend({ ...snapshot(draft), tier })}
    />
  );
}

const png = (name = "sketsa.png") =>
  new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
const message = () => screen.getByRole("textbox", { name: t.composer.label });
const send = () => screen.getByRole("button", { name: t.composer.send });
const chips = () => screen.queryByRole("list", { name: t.composer.pendingAttachments });

/**
 * Event tempel seperti di Chromium: file ada di `files` dan di `items`. happy-dom tidak mengisi `clipboardData` dari
 * opsi event, jadi diisi langsung.
 */
function paste(target: HTMLElement, files: readonly File[]) {
  const event = createEvent.paste(target);
  const items = files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file }));
  const types = files.length === 0 ? ["text/plain"] : ["Files"];
  Object.defineProperty(event, "clipboardData", { value: { files, items, types, getData: () => "teks" } });
  fireEvent(target, event);
}

describe("composer dock", () => {
  test("Enter mengirim, Shift+Enter membuat baris baru; teks kosong tidak bisa dikirim", async () => {
    const onSend = mock((_sent: Sent) => undefined);
    const { user } = renderUi(<DockHarness onSend={onSend} />);
    expect(send().hasAttribute("disabled")).toBe(true);
    await user.type(message(), "{Enter}");
    expect(onSend).not.toHaveBeenCalled();

    await user.type(message(), "Tutup lebih tebal{Shift>}{Enter}{/Shift}engsel besi");
    expect((message() as HTMLTextAreaElement).value).toBe("Tutup lebih tebal\nengsel besi");
    expect(onSend).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledWith({ text: "Tutup lebih tebal\nengsel besi", files: [] });
  });

  test("teks wajib (server menolak pesan kosong): lampiran saja belum bisa dikirim; unggah lewat klip kertas, hapus lewat chip", async () => {
    const onSend = mock((_sent: Sent) => undefined);
    const { user } = renderUi(<DockHarness onSend={onSend} />);
    await user.upload(screen.getByLabelText(t.composer.attach, { selector: "input" }), png());
    const list = chips();
    expect(list).not.toBeNull();
    expect(within(list as HTMLElement).getByText("PNG · 4 B")).toBeDefined();
    expect(send().hasAttribute("disabled")).toBe(true);
    await user.type(message(), "{Enter}");
    expect(onSend).not.toHaveBeenCalled();
    await user.type(message(), "Ikuti sketsa ini{Enter}");
    expect(onSend).toHaveBeenCalledWith({ text: "Ikuti sketsa ini", files: ["sketsa.png"] });

    await user.click(screen.getByRole("button", { name: t.attachment.remove("sketsa.png") }));
    expect(chips()).toBeNull();
  });

  test("saat mengirim: isian tetap fokus (hanya-baca, bukan nonaktif); klik Kirim memindah fokus ke isian", async () => {
    const finishers: Array<() => void> = [];
    const { user } = renderUi(<SendingHarness onSend={(finish) => finishers.push(finish)} />);
    await user.type(message(), "Tutup lebih tebal{Enter}");
    expect(finishers).toHaveLength(1);
    const field = message() as HTMLTextAreaElement;
    expect(document.activeElement).toBe(field);
    expect(field.readOnly).toBe(true);
    expect(field.disabled).toBe(false);
    expect(send().getAttribute("aria-busy")).toBe("true");
    // Lampiran tidak bisa ditambah selama mengirim: draf dikosongkan setelah terkirim.
    expect(screen.getByRole("button", { name: t.composer.attach }).hasAttribute("disabled")).toBe(true);
    await act(async () => paste(field, [png("tempel.png")]));
    expect(chips()).toBeNull();

    act(() => finishers[0]?.());
    expect(field.value).toBe("");
    expect(field.readOnly).toBe(false);
    expect(document.activeElement).toBe(field);

    await user.type(field, "Engsel besi");
    act(() => send().focus());
    await user.keyboard("{Enter}");
    expect(finishers).toHaveLength(2);
    expect(document.activeElement).toBe(field);
  });

  test("tempel gambar menambah satu lampiran; teks tempelan biasa tidak", async () => {
    renderUi(<DockHarness onSend={() => undefined} />);
    await act(async () => paste(message(), [png("tempel.png")]));
    expect(within(chips() as HTMLElement).getAllByRole("listitem")).toHaveLength(1);
    expect(within(chips() as HTMLElement).getByText("tempel.png")).toBeDefined();
    await act(async () => paste(message(), []));
    expect(within(chips() as HTMLElement).getAllByRole("listitem")).toHaveLength(1);
  });

  test("file ditolak dan kelebihan jumlah dilaporkan lewat toast", async () => {
    const { user } = renderUi(
      <>
        <DockHarness onSend={() => undefined} />
        <Toaster />
      </>,
    );
    const picker = screen.getByLabelText(t.composer.attach, { selector: "input" });
    // Jenis file di luar `accept` tetap bisa sampai (seret-lepas, tempel); `applyAccept: false` meniru itu.
    await userUpload(user, picker, [new File(["%PDF"], "catatan.pdf")]);
    expect(await screen.findByText(t.composer.unsupported("catatan.pdf"))).toBeDefined();
    expect(chips()).toBeNull();

    const many = Array.from({ length: ATTACHMENT_MAX_FILES + 1 }, (_, index) => png(`ref-${index}.png`));
    await userUpload(user, picker, many);
    expect(await screen.findByText(t.composer.tooMany(ATTACHMENT_MAX_FILES))).toBeDefined();
    expect(within(chips() as HTMLElement).getAllByRole("listitem")).toHaveLength(ATTACHMENT_MAX_FILES);
  });

  test("nonaktif (menunggu jawaban): isian dan tombol terkunci; kamera hanya bila ada versi", async () => {
    const onCapture = mock(() => undefined);
    const { user, unmount } = renderUi(<DockHarness onSend={() => undefined} onCapture={onCapture} />);
    await user.click(screen.getByRole("button", { name: t.composer.capture }));
    expect(onCapture).toHaveBeenCalledTimes(1);
    unmount();

    renderUi(<DockHarness onSend={() => undefined} disabled />);
    expect(message().hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: t.composer.attach }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: t.composer.capture })).toBeNull();
    expect(send().hasAttribute("disabled")).toBe(true);
  });

  test("seret file ke composer: petunjuk lepas tampil, file yang dilepas menjadi lampiran", async () => {
    renderUi(<DockHarness onSend={() => undefined} />);
    const form = message().closest("form") as HTMLFormElement;
    const file = png("seret.png");
    const dataTransfer = {
      files: [file],
      items: [{ kind: "file", type: file.type, getAsFile: () => file }],
      types: ["Files"],
    };
    fireEvent.dragEnter(form, { dataTransfer });
    expect(await screen.findByText(t.composer.dropHint)).toBeDefined();
    fireEvent.drop(form, { dataTransfer });
    expect(await screen.findByText("seret.png")).toBeDefined();
    await waitFor(() => expect(screen.queryByText(t.composer.dropHint)).toBeNull());
  });
});

describe("composer aset baru", () => {
  test("teks wajib: lampiran saja belum bisa dikirim; Enter mengirim prompt + tier terpilih", async () => {
    const onSend = mock((_sent: Sent & { tier: TierId }) => undefined);
    const { user } = renderUi(<PromptHarness onSend={onSend} />);
    const prompt = screen.getByRole("textbox", { name: t.studio.promptLabel });
    expect(prompt.getAttribute("aria-describedby")).not.toBeNull();
    expect(screen.getByText(t.composer.enterHint).id).toBe(prompt.getAttribute("aria-describedby") ?? "");

    await user.upload(screen.getByLabelText(t.composer.addImage, { selector: "input" }), png("sketsa.png"));
    expect(send().hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("radio", { name: t.tier.ringan }));
    await user.type(prompt, "Peti harta kayu{Enter}");
    expect(onSend).toHaveBeenCalledWith({ text: "Peti harta kayu", files: ["sketsa.png"], tier: "ringan" });
  });
});

/** `user.upload` tanpa menyaring `accept`, untuk file yang datang dari luar pemilih (seret-lepas, tempel). */
async function userUpload(
  user: ReturnType<typeof renderUi>["user"],
  input: HTMLElement,
  files: readonly File[],
): Promise<void> {
  const original = input.getAttribute("accept");
  input.removeAttribute("accept");
  await user.upload(input, [...files]);
  if (original !== null) input.setAttribute("accept", original);
}
