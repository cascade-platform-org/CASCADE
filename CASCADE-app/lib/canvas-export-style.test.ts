import { describe, expect, it } from "vitest";

import { exportBackground, labelScale, PRINT_LABEL_SCALE } from "./canvas-export-style";

describe("canvas export style", () => {
  it("keeps the on-screen background and label size by default", () => {
    expect(exportBackground(undefined, "screen-colour")).toBe("screen-colour");
    expect(exportBackground({ print: false }, "screen-colour")).toBe("screen-colour");
    expect(labelScale()).toBe(1);
  });

  it("print style leaves the background transparent and names 2 px larger", () => {
    expect(exportBackground({ print: true }, "screen-colour")).toBeUndefined();
    expect(labelScale({ print: true })).toBe(PRINT_LABEL_SCALE);
    expect(13 * PRINT_LABEL_SCALE).toBeCloseTo(15);
  });
});
