/**
 * series.ts — a Series: project-wide numbers by Element and period label
 * (ADR-0019, revised 2026-10-12). An Attribute Operation reads one as a factor
 * of its operand (`series`) at the label of the period being run; the `*` row
 * serves Elements without a row of their own, and a missing value refuses the
 * write. Client data: the Propagation request leaves it out. Mirrors
 * `schemas/series.py`.
 */

import { z } from "zod";
import { isSafeKey, UNSAFE_KEY_MESSAGE } from "./field-path";
import { FiniteNumberSchema, OperandNameSchema } from "./operand";

export const ALL_ELEMENTS = "*";

const SafeKeySchema = z.string().refine(isSafeKey, UNSAFE_KEY_MESSAGE);

export const SeriesSchema = z
  .object({
    name: OperandNameSchema,
    unit: z.string().optional(),
    description: z.string().optional(),
    /** Row key (an Element id, or "*" for every Element without a row of its own) → period label → number. */
    rows: z.record(SafeKeySchema, z.record(SafeKeySchema, FiniteNumberSchema)).default({}),
  })
  .strict();
export type Series = z.infer<typeof SeriesSchema>;
