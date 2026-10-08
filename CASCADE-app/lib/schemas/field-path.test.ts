import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { AttributeOperationSchema } from "./attribute-operation";
import { FieldChangeSchema } from "./network";
import { UNSAFE_KEYS } from "./field-path";
import { applyOperationTo, readPath } from "@/lib/attribute-operations";
import { writeFieldValue } from "@/lib/graph-diff";

const unsafe = fc.constantFrom(...UNSAFE_KEYS);
const key = fc.oneof(fc.string({ minLength: 1 }), unsafe);
const pathWithUnsafe = fc.tuple(fc.array(key), unsafe, fc.array(key)).map(([a, u, b]) => [...a, u, ...b]);

describe("field paths", () => {
  it("refuse __proto__, constructor and prototype at any depth, in an operation and a Graph Diff", () => {
    fc.assert(fc.property(pathWithUnsafe, (path) => {
      expect(AttributeOperationSchema.safeParse({ element: "a", path, op: "set", value: 1 }).success).toBe(false);
      expect(FieldChangeSchema.safeParse({ field: "properties", path, before: 0, after: 1 }).success).toBe(false);
    }));
  });

  it("never reach a prototype, whatever the path, even unvalidated", () => {
    const builtIns = Object.getOwnPropertyNames(Object.prototype);
    fc.assert(fc.property(fc.array(key, { minLength: 1, maxLength: 5 }), fc.oneof(fc.integer(), fc.string()), (path, value) => {
      const node = { id: "a", label: "a", functionality: 2, properties: {} };
      applyOperationTo(node, "node", { element: "a", path, op: "set", value }, 4);
      try { writeFieldValue({ ...node }, path[0], path.slice(1), value); } catch { /* refused */ }
      expect(Object.getOwnPropertyNames(Object.prototype)).toEqual(builtIns);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(Object.getPrototypeOf(node)).toBe(Object.prototype);
    }));
  });

  it("read only an object's own fields", () => {
    expect(readPath({ properties: {} }, ["properties", "constructor"])).toEqual({ value: undefined });
    expect(readPath({ properties: {} }, ["properties", "toString"])).toEqual({ value: undefined });
  });

  it("refuse an unsafe write with a reason, keeping the Element", () => {
    const node = { id: "a", label: "a", functionality: 2 };
    expect(applyOperationTo(node, "node", { element: "a", path: ["__proto__", "polluted"], op: "set", value: 1 }, 4)).toMatchObject({ error: expect.stringMatching(/cannot be field names/) });
    expect(() => writeFieldValue({}, "properties", ["__proto__"], 1)).toThrow(/cannot be a field name/);
  });
});
