import { describe, expect, it } from "vitest";
import { INJECTED_SCRIPT_ERRORS } from "./observability";

const dropped = (message: string) => INJECTED_SCRIPT_ERRORS.some((p) => p.test(message));

describe("INJECTED_SCRIPT_ERRORS", () => {
  it.each([
    "ReferenceError: Can't find variable: __firefox__",
    "TypeError: undefined is not an object (evaluating 'window.__firefox__.reader')",
    "TypeError: undefined is not an object (evaluating 'window.ethereum.selectedAddress = undefined')",
  ])("drops the browser-injected error %s", (message) => {
    expect(dropped(message)).toBe(true);
  });

  it.each([
    "TypeError: undefined is not an object (evaluating 'node.data.label')",
    "ReferenceError: Can't find variable: graph",
  ])("keeps the application error %s", (message) => {
    expect(dropped(message)).toBe(false);
  });
});
