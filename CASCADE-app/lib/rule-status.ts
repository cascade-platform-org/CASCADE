/**
 * rule-status.ts — helpers for the "rule disabled" convention.
 *
 * A rule string prefixed with `"// "` is **inactive**: the engine skips it and
 * the UI shows it muted.  The prefix value is sourced from the shared grammar
 * spec (CASCADE-app/shared/rule-grammar.json) so the frontend and backend can
 * never drift.  The backend reads the same file via core/rule_grammar.py.
 */

import grammar from "@/shared/rule-grammar.json";

/** Prefix that marks a rule string as disabled (inactive). */
export const DISABLED_RULE_PREFIX: string = grammar.disabled_rule_prefix;

/** True when the rule is disabled (commented out). */
export function isRuleDisabled(rule: string): boolean {
  return rule.startsWith(DISABLED_RULE_PREFIX);
}

/** The rule's authored text, without the disabled prefix. */
export function ruleBody(rule: string): string {
  return isRuleDisabled(rule) ? rule.slice(DISABLED_RULE_PREFIX.length) : rule;
}

/** Flip a rule's active/inactive state, preserving its text. */
export function toggleRuleDisabled(rule: string): string {
  return isRuleDisabled(rule) ? ruleBody(rule) : DISABLED_RULE_PREFIX + rule;
}

/** Replace a rule's text while keeping its current active/inactive state. */
export function setRuleBody(rule: string, body: string): string {
  return isRuleDisabled(rule) ? DISABLED_RULE_PREFIX + body : body;
}
