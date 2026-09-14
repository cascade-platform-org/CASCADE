import { describe, it, expect } from "vitest";
import { formatBytes } from "./file-io";

describe("formatBytes", () => {
  it("renders sub-KB counts as bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(340)).toBe("340 B");
    expect(formatBytes(999)).toBe("999 B");
  });

  it("switches to KB at 1000 bytes, with one decimal below 10", () => {
    expect(formatBytes(1000)).toBe("1.0 KB");
    expect(formatBytes(1_240)).toBe("1.2 KB");
  });

  it("rounds to a whole number once the value reaches double digits", () => {
    expect(formatBytes(12_400)).toBe("12 KB");
  });

  it("drops the decimal once the value reaches double digits", () => {
    expect(formatBytes(9_900)).toBe("9.9 KB");
    expect(formatBytes(10_000)).toBe("10 KB");
    expect(formatBytes(999_000)).toBe("999 KB");
  });

  it("climbs to MB and GB", () => {
    expect(formatBytes(1_200_000)).toBe("1.2 MB");
    expect(formatBytes(3_400_000_000)).toBe("3.4 GB");
  });

  it("never climbs past GB even for absurd inputs", () => {
    expect(formatBytes(9_999_000_000_000)).toBe("9999 GB");
  });

  it("treats negative or non-finite input as zero rather than throwing", () => {
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(NaN)).toBe("0 B");
    expect(formatBytes(Infinity)).toBe("0 B");
  });
});
