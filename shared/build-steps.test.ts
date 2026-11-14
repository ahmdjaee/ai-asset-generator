import { describe, expect, test } from "bun:test";
import { PIPELINE_STEPS, phaseOfStep } from "./build-steps.ts";

describe("phaseOfStep", () => {
  test("langkah harness → optimasi/render; langkah container apa pun → sandbox", () => {
    expect(phaseOfStep(PIPELINE_STEPS.optimize)).toBe("optimize");
    expect(phaseOfStep(PIPELINE_STEPS.render)).toBe("render");
    expect(phaseOfStep(PIPELINE_STEPS.save)).toBe("render");
    expect(phaseOfStep("ekspor")).toBe("sandbox");
    expect(phaseOfStep("")).toBe("sandbox");
  });
});
