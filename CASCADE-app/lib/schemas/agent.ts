/**
 * agent.ts — Agent Bridge personal tokens (ADR-0024). Mirrors `schemas/agent.py`.
 */

import { z } from "zod";

export const CreateAgentTokenRequestSchema = z.object({ name: z.string().min(1).max(100) }).strict();

/** A token as listed: never its value. */
export const AgentTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  created_at: z.string(),
  last_used_at: z.string().nullable().optional(),
  expires_at: z.string(),
});

/** The one response that carries the token's value. */
export const CreatedAgentTokenSchema = z.object({ token: z.string(), record: AgentTokenSchema });

export type AgentToken = z.infer<typeof AgentTokenSchema>;
export type CreatedAgentToken = z.infer<typeof CreatedAgentTokenSchema>;
