/**
 * provenance.ts — what LLM Design or an agent added, and whether a person has
 * confirmed it (ADR-0022, ADR-0024). Mirrors `schemas/provenance.py`. The
 * engine never reads it.
 */

import { z } from "zod";

export const PROVENANCE_ORIGIN = "llm_design";
/** `llm_design`: pasted into LLM Design; `agent`: a Proposal an agent made through the Agent Bridge. */
export const ProvenanceOriginSchema = z.enum([PROVENANCE_ORIGIN, "agent"]);
export type ProvenanceOrigin = z.infer<typeof ProvenanceOriginSchema>;

export const ProvenanceSchema = z
  .object({
    origin: ProvenanceOriginSchema,
    /** Why it was added: the change's `why`. */
    rationale: z.string().optional(),
    /** True once a person has confirmed it. */
    confirmed: z.boolean().default(false),
  })
  .strict();

export type Provenance = z.infer<typeof ProvenanceSchema>;
