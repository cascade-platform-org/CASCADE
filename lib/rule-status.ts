/**
 * rule-status.ts — the single source of truth for the "rule disabled" convention.
 *
 * A rule string prefixed with `"// "` is **inactive**: the engine skips it and
 * the UI shows it muted. This is the one place the prefix is defined; the
 * Inspector and the Active Rules panel both import from here, so the convention
 * can never drift between them.
 *
 * Consistency with the engine: the backend uses the identical prefix and skips
 * disabled rules at parse time — see `DISABLED_RULE_PREFIX` / `is_rule_disabled`
 * in CASCADE-backend/core/rule_parser.py. Keep the two in lockstep.
 */

/** Prefix that marks a rule string as disabled (inactive). */
export const DISABLED_RULE_PREFIX = "// ";

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
