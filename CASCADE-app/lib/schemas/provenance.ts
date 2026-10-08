/**
 * provenance.ts — what LLM Design added, and whether a person has confirmed it
 * (ADR-0022). Mirrors `schemas/provenance.py`. The engine never reads it.
 */

import { z } from "zod";

export const PROVENANCE_ORIGIN = "llm_design";

export const ProvenanceSchema = z
  .object({
    origin: z.literal(PROVENANCE_ORIGIN),
    /** Why it was added: the change's `why`. */
    rationale: z.string().optional(),
    /** True once a person has confirmed it. */
    confirmed: z.boolean().default(false),
  })
  .strict();

export type Provenance = z.infer<typeof ProvenanceSchema>;
