/**
 * provenance.ts — what LLM Design or a Workbook import added, and whether a
 * person has confirmed it (ADR-0022, ADR-0023). Mirrors `schemas/provenance.py`.
 * The engine never reads it.
 */

import { z } from "zod";

export const PROVENANCE_ORIGINS = ["llm_design", "spreadsheet"] as const;
export type ProvenanceOrigin = (typeof PROVENANCE_ORIGINS)[number];

/** The Workbook row a record came from. */
export const SourceLocatorSchema = z
  .object({
    file: z.string().min(1).max(255),
    sheet: z.string().min(1).max(255),
    row: z.number().int().min(1),
  })
  .strict();
export type SourceLocator = z.infer<typeof SourceLocatorSchema>;

export const ProvenanceSchema = z
  .object({
    origin: z.enum(PROVENANCE_ORIGINS),
    /** Why it was added: the change's `why`. */
    rationale: z.string().optional(),
    /** True once a person has confirmed it. */
    confirmed: z.boolean().default(false),
    /** For a spreadsheet: the file, sheet and row. */
    source: SourceLocatorSchema.optional(),
  })
  .strict()
  .refine((p) => p.source === undefined || p.origin === "spreadsheet", {
    message: '`source` is only for origin "spreadsheet"',
    path: ["source"],
  });

export type Provenance = z.infer<typeof ProvenanceSchema>;
