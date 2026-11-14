import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  test("tautan http(s) dibuka di tab baru tanpa referrer", () => {
    render(<Markdown>{"Lihat [panduan glTF](https://www.khronos.org/gltf/)."}</Markdown>);
    const link = screen.getByRole("link", { name: "panduan glTF" });
    expect(link.getAttribute("href")).toBe("https://www.khronos.org/gltf/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  test("tautan javascript: dan HTML mentah berbahaya menjadi teks biasa, tanpa penanda berbahasa Inggris", () => {
    const { container } = render(
      <Markdown>
        {'[klik](javascript:alert(1)) <img src="x" onerror="alert(1)"> <script>alert(1)</script> aman'}
      </Markdown>,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector("script, img, [onerror]")).toBeNull();
    expect(container.textContent).toContain("klik");
    expect(container.textContent).toContain("aman");
    expect(container.textContent).not.toMatch(/blocked|Image/);
  });

  test("skema tautan: mailto dan path relatif tetap tautan; data: dan file: menjadi teks biasa", () => {
    render(
      <Markdown>
        {"[surel](mailto:studio@example.com) [unduh](/api/assets/a/versions/1/web.glb) " +
          "[data](data:text/html,halo) [berkas](file:///etc/hosts)"}
      </Markdown>,
    );
    expect(screen.getByRole("link", { name: "surel" }).getAttribute("href")).toBe(
      "mailto:studio@example.com",
    );
    expect(screen.getByRole("link", { name: "unduh" }).getAttribute("href")).toBe(
      "/api/assets/a/versions/1/web.glb",
    );
    expect(screen.queryByRole("link", { name: "data" })).toBeNull();
    expect(screen.queryByRole("link", { name: "berkas" })).toBeNull();
    expect(screen.getByText(/berkas/)).toBeDefined();
  });

  test("gambar tidak pernah dimuat; yang tersisa hanya teks alt", () => {
    const { container } = render(
      <Markdown>
        {"![sketsa peti](https://example.com/peti.png)\n\n![](data:image/png;base64,iVBORw0KGgo=)"}
      </Markdown>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("sketsa peti");
    expect(container.textContent).not.toContain("Image not available");
  });

  test("teks yang masih di-stream: tebal tanpa penutup tidak tampil mentah", () => {
    const { container } = render(<Markdown streaming>{"Tutup **lebih tebal"}</Markdown>);
    expect(container.textContent).not.toContain("**");
    expect(container.textContent).toContain("lebih tebal");
  });
});
