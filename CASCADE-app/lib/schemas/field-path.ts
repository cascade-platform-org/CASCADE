/**
 * field-path.ts — a path into an Element's fields, as Attribute Operations,
 * Metrics and Graph Diffs address it (ADR-0021).
 *
 * A path comes from a file or a pasted text, and code follows it with
 * `record[key]`. The keys JavaScript gives a meaning on every object
 * (`__proto__`, `constructor`, `prototype`) would reach the object's prototype
 * instead of a field, so a path holding one is refused. Mirrors `FieldPath` in
 * CASCADE-backend/schemas/field_path.py.
 */

import { z } from "zod";

export const UNSAFE_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

export const isSafeKey = (key: string): boolean => !UNSAFE_KEYS.has(key);

export const UNSAFE_KEY_MESSAGE = { message: "__proto__, constructor and prototype cannot be field names" };

const FieldKeySchema = z.string().min(1).refine(isSafeKey, UNSAFE_KEY_MESSAGE);

export const FieldPathSchema = z.array(FieldKeySchema).min(1);
