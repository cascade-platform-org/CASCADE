/**
 * operand.ts — names and numbers an Attribute Operation's operand reads
 * (ADR-0021, revised 2026-10-12): Parameter and Series names, and the finite
 * numbers they hold. A name is an identifier, so it works unchanged as a sheet
 * header, a sheet title and in LLM text. Mirrors `schemas/operand.py`.
 */

import { z } from "zod";
import { isSafeKey, UNSAFE_KEY_MESSAGE } from "./field-path";

export const OPERAND_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export const OperandNameSchema = z
  .string()
  .regex(OPERAND_NAME_PATTERN, "a name of letters, digits and _, not starting with a digit (at most 64)")
  .refine(isSafeKey, UNSAFE_KEY_MESSAGE);

export const FiniteNumberSchema = z.number().finite();

/** Names that occur more than once, in first-repeat order. */
export function duplicateNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated: string[] = [];
  for (const name of names) {
    if (seen.has(name) && !repeated.includes(name)) repeated.push(name);
    seen.add(name);
  }
  return repeated;
}
