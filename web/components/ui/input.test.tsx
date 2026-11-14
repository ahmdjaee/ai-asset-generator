import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Field, Input, Textarea } from "./input.tsx";

describe("Field + Input/Textarea", () => {
  test("label tersambung, teks bantuan menjadi deskripsi", async () => {
    render(
      <Field id="nama" label="Nama aset" description="Maksimal 80 karakter.">
        {(control) => <Input {...control} placeholder="Mis. Peti harta kayu" />}
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Nama aset" });
    expect(input.getAttribute("aria-describedby")).toBe("nama-bantuan");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    await userEvent.setup().type(input, "Peti");
    expect((input as HTMLInputElement).value).toBe("Peti");
  });

  test("error: aria-invalid, pesan error sebagai deskripsi, gaya danger", () => {
    render(
      <Field id="nama" label="Nama aset" error="Nama tidak boleh kosong.">
        {(control) => <Input {...control} />}
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Nama aset" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Nama tidak boleh kosong.").className).toContain("text-danger-text");
  });

  test("Textarea: multi-baris dengan tinggi minimal 88 dan teks Body", () => {
    render(
      <Field id="catatan" label="Catatan">
        {(control) => <Textarea {...control} />}
      </Field>,
    );
    const textarea = screen.getByRole("textbox", { name: "Catatan" });
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea.className).toContain("min-h-22");
    expect(textarea.className).toContain("text-body");
  });
});
