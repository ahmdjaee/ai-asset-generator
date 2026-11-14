import { describe, expect, test } from "bun:test";
import { screen } from "@testing-library/react";
import { renderUi } from "@/test-utils.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "./menu.tsx";
import { Tooltip } from "./tooltip.tsx";

describe("Tooltip", () => {
  test("pemicu menu di dalam tooltip tetap memakai data-state menu, sumber gaya terbukanya", async () => {
    const { user } = renderUi(
      <Menu>
        <Tooltip label="Sudut kamera">
          <MenuTrigger aria-label="Sudut kamera">Sudut</MenuTrigger>
        </Tooltip>
        <MenuContent>
          <MenuItem>Depan</MenuItem>
        </MenuContent>
      </Menu>,
    );
    const trigger = screen.getByRole("button", { name: "Sudut kamera" });
    expect(trigger.getAttribute("data-state")).toBe("closed");
    await user.click(trigger);
    await screen.findByRole("menu");
    expect(trigger.getAttribute("data-state")).toBe("open");
  });
});
