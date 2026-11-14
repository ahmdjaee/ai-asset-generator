import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Package } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { EmptyState } from "./EmptyState.tsx";

describe("EmptyState", () => {
  test("judul sebagai heading (level bisa diatur), isi, dan aksi", () => {
    render(
      <EmptyState
        icon={Package}
        headingLevel={1}
        title="Belum ada aset"
        description="Aset yang Anda buat di Studio akan muncul di sini."
        action={<Button variant="primary">Aset baru</Button>}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Belum ada aset" })).toBeDefined();
    expect(screen.getByText("Aset yang Anda buat di Studio akan muncul di sini.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Aset baru" })).toBeDefined();
  });
});
