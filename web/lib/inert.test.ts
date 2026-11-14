import { afterEach, describe, expect, test } from "bun:test";
import { inertOutside } from "./inert.ts";

const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

function mount(html: string): void {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  hosts.push(host);
}

function byId(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} tidak ada`);
  return found;
}

/** Inert efektif: elemen itu sendiri atau salah satu leluhurnya. */
const inert = (id: string) => byId(id).closest("[inert]") !== null;

describe("inertOutside", () => {
  test("saudara di setiap tingkat sampai body menjadi inert; leluhur, isi elemen, dan live region tidak", () => {
    mount(`
      <div id="app">
        <nav id="rail"><a href="/">Studio</a></nav>
        <main id="main">
          <aside id="side"><button type="button">Kirim</button></aside>
          <section id="viewer"><button id="inside" type="button">Layar penuh</button></section>
        </main>
        <section id="toasts" aria-live="polite"></section>
      </div>
    `);
    mount('<div id="portal"></div>');

    const restore = inertOutside(byId("viewer"));

    expect(["rail", "side", "portal"].map(inert)).toEqual([true, true, true]);
    expect(["app", "main", "viewer", "inside", "toasts"].map(inert)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    restore();
    expect(["rail", "side", "portal"].map(inert)).toEqual([false, false, false]);
  });

  test("elemen yang sudah inert sebelumnya tetap inert setelah dipulihkan", () => {
    mount('<div id="area"><div id="dialog-lain" inert></div><section id="viewer"></section></div>');
    const restore = inertOutside(byId("viewer"));
    expect(inert("dialog-lain")).toBe(true);
    restore();
    expect(inert("dialog-lain")).toBe(true);
  });
});
