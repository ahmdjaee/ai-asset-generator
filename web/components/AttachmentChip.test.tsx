import { describe, expect, mock, test } from "bun:test";
import { screen } from "@testing-library/react";
import { renderUi } from "@/test-utils.tsx";
import { AttachmentChip } from "./AttachmentChip.tsx";

describe("AttachmentChip", () => {
  test("nama, keterangan, dan tombol hapus bernama", async () => {
    const onRemove = mock();
    const { user } = renderUi(
      <AttachmentChip name="sketsa-peti.jpg" meta="JPG · 184 KB" onRemove={onRemove} />,
    );
    expect(screen.getByText("sketsa-peti.jpg")).toBeDefined();
    expect(screen.getByText("JPG · 184 KB")).toBeDefined();
    await user.tab();
    await user.keyboard("{Enter}");
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Hapus lampiran sketsa-peti.jpg" })).toBeDefined();
  });

  test("mengunggah dan gagal mengganti keterangan dengan status", () => {
    renderUi(
      <>
        <AttachmentChip name="a.png" meta="PNG" status="uploading" />
        <AttachmentChip name="b.png" meta="PNG" status="error" />
      </>,
    );
    expect(screen.getByText("Mengunggah…")).toBeDefined();
    expect(screen.getByText("Gagal diunggah").className).toContain("text-danger-text");
    expect(screen.queryByText("PNG")).toBeNull();
  });

  test("versi ringkas di pesan: tanpa keterangan dan tanpa tombol hapus", () => {
    renderUi(<AttachmentChip compact name="sketsa-peti.jpg" meta="JPG" onRemove={() => undefined} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("JPG")).toBeNull();
  });
});
