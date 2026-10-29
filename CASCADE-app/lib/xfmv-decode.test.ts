import { describe, expect, it } from "vitest";
import { decodeXfmv } from "./xfmv-decode";

describe("decodeXfmv", () => {
  it("reads UTF-8 as UTF-8", () => {
    const bytes = new TextEncoder().encode("<IDName>Città</IDName>");
    expect(decodeXfmv(bytes.buffer as ArrayBuffer)).toBe("<IDName>Città</IDName>");
  });

  it("falls back to cp1252 when the bytes are not UTF-8", () => {
    // "affinché" in cp1252: é is the single byte 0xE9, invalid on its own in UTF-8.
    const bytes = new Uint8Array([...new TextEncoder().encode("affinch"), 0xe9]);
    expect(decodeXfmv(bytes.buffer)).toBe("affinché");
  });
});
