/**
 * rule-suggestions.ts — context-aware suggestion engine for the rule DSL.
 *
 * Mirrors the grammar described in cascade-backend/core/rule_parser.py. Given
 * the text before the cursor it determines which grammar production is active
 * and returns ordered completion candidates filtered by the partial token the
 * user is currently typing.
 *
 * Three rule shapes (see CONTEXT.md → *Rule*):
 *
 *   Specific       if <condition> then <target> is <level>
 *   Intracategorical  <func>(<elements>) propagates to <target>
 *   Intercategorical  <func>(<categories>) propagates to <target>
 *
 * The suggestion context is derived purely from the sequence of already-typed
 * tokens; the partial word (the incomplete token at the cursor) is used only
 * for prefix-filtering the generated candidates.
 */

// ---------------------------------------------------------------------------
// Constants — sourced from the shared grammar spec
// ---------------------------------------------------------------------------
// CASCADE-app/shared/rule-grammar.json is the single source of truth for the
// Rule DSL grammar.  The backend reads it via core/rule_grammar.py.  Any
// grammar change (new function, operator, attribute) must be made there only.

import grammar from "@/shared/rule-grammar.json";

export const RULE_FUNC_NAMES: readonly string[] = grammar.function_names;
export const RULE_OPERATORS: readonly string[] = grammar.operators;
export const NODE_ATTRIBUTES: readonly string[] = grammar.node_attributes;

// ---------------------------------------------------------------------------
// Context type
// ---------------------------------------------------------------------------

/**
 * What the grammar expects to see NEXT after the already-committed tokens.
 * Determines which candidate set is generated.
 */
export type RuleContext =
  | "start"              // blank line — expect 'if' or function name
  | "element_in_cond"    // after 'if' / 'and' / 'or' / 'not' — expect element
  | "is_or_dot"          // after element in condition — expect 'is' or '.attr'
  | "attribute"          // after '.' — expect attribute name
  | "op_or_level"        // after 'is' in condition — expect operator or level
  | "level_only"         // after operator, or 'is' in then-block — expect level value
  | "continuation"       // after condition value — expect 'and' / 'or' / 'then'
  | "then_element"       // after 'then' — expect target element
  | "is_after_then_elem" // after element in then-block — expect 'is'
  | "in_func_args"       // inside '(' of propagation function — expect element or category
  | "after_func"         // after ')' — expect 'propagates'
  | "after_propagates"   // after 'propagates' — expect 'to'
  | "prop_target"        // after 'to' (propagation rule) — expect target element
  | "unknown";           // cannot determine — fall back to broad set

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/**
 * Splits rule text into tokens. Mirrors the tokenize_rule logic in the
 * backend parser: whitespace separates; `(`, `)`, `,`, `.` are own tokens;
 * operator sequences `<`, `<=`, `>`, `>=`, `=`, `≠` are own tokens.
 */
function tokenize(text: string): string[] {
  return text.match(/\w+|[<>=≠]+|[().,]/g) ?? [];
}

// ---------------------------------------------------------------------------
// Partial-token extraction
// ---------------------------------------------------------------------------

/**
 * Returns the incomplete token at the cursor and its start position in the
 * original text — the span that will be replaced when a suggestion is applied.
 *
 * "Partial" is the last token in the before-cursor text when that text does
 * NOT end with whitespace. It may be an identifier fragment ("cri"), an
 * operator fragment ("<"), a dot ("."), or a punctuation char.
 *
 * When the cursor is right after whitespace (or at the start), partial = ""
 * and wordStart = cursorPos (insertion, not replacement).
 */
export function getPartialToken(
  text: string,
  cursorPos: number,
): { partial: string; wordStart: number } {
  const before = text.slice(0, cursorPos);
  if (!before || /\s$/.test(before)) {
    return { partial: "", wordStart: cursorPos };
  }
  const tokens = tokenize(before);
  if (tokens.length === 0) return { partial: "", wordStart: cursorPos };
  const last = tokens[tokens.length - 1];
  // lastIndexOf to find the rightmost occurrence (handles duplicate sub-strings).
  const wordStart = before.lastIndexOf(last, before.length);
  return { partial: last, wordStart };
}

// ---------------------------------------------------------------------------
// Context detection
// ---------------------------------------------------------------------------

/**
 * Derive the current grammar context from the sequence of already-committed
 * tokens (everything before the current partial token).
 */
export function detectRuleContext(settled: string[]): RuleContext {
  if (settled.length === 0) return "start";

  const lower = settled.map((t) => t.toLowerCase());
  const last = lower[lower.length - 1];
  const secondLast = lower.length >= 2 ? lower[lower.length - 2] : "";

  // ── Paren depth — inside function args? ──────────────────────────────────
  let parenDepth = 0;
  for (const t of settled) {
    if (t === "(") parenDepth++;
    if (t === ")") parenDepth--;
  }
  if (parenDepth > 0) return "in_func_args";

  // ── Single-token triggers ─────────────────────────────────────────────────
  if (last === ".") return "attribute";
  if (last === ")") return "after_func";
  if (last === "propagates") return "after_propagates";
  if (last === "then") return "then_element";
  if (last === "if" || last === "and" || last === "or" || last === "not")
    return "element_in_cond";

  // ── 'to' after 'propagates' ───────────────────────────────────────────────
  if (last === "to" && lower.includes("propagates")) return "prop_target";

  // ── Operator → expect level value ────────────────────────────────────────
  if ((RULE_OPERATORS as readonly string[]).includes(last)) return "level_only";

  // ── 'is' — condition or then-block? ──────────────────────────────────────
  if (last === "is") {
    // Look for the most recent 'then' and count what's between it and here.
    const thenIdx = lower.lastIndexOf("then");
    if (thenIdx >= 0) {
      const afterThen = lower.slice(thenIdx + 1);
      // Pattern: [ELEMENT, 'is'] → the 'is' belongs to 'then ELEMENT is'
      const nonKeyTokens = afterThen.filter(
        (t) => t !== "is" && !(RULE_OPERATORS as readonly string[]).includes(t),
      );
      if (nonKeyTokens.length === 1) return "level_only"; // expect level, no operators
    }
    return "op_or_level"; // in condition: expect operator or level label
  }

  // ── The last settled token is an identifier / number ─────────────────────

  // After 'then', before any 'is': last token is the target element.
  if (lower.includes("then")) {
    const thenIdx = lower.lastIndexOf("then");
    const afterThen = lower.slice(thenIdx + 1);
    if (!afterThen.includes("is")) return "is_after_then_elem";
    // After 'then ELEMENT is VALUE' — rule is complete.
    return "unknown";
  }

  // After a condition value (secondLast is an operator or 'is').
  if (
    (RULE_OPERATORS as readonly string[]).includes(secondLast) ||
    secondLast === "is"
  ) {
    return "continuation";
  }

  // All other cases: an element name in the condition body.
  return "is_or_dot";
}

// ---------------------------------------------------------------------------
// Suggestion computation
// ---------------------------------------------------------------------------

export interface RuleSuggestionCtx {
  /** Display labels of all in-scope nodes (used as element references). */
  elementLabels: string[];
  /** Category names from the Model Configuration. */
  categoryNames: string[];
  /** Functionality scale labels (e.g. ['critical', 'warning', 'operational']). */
  functionalityLabels: string[];
  /** N — the maximum functionality level integer. */
  functionalityN: number;
}

/**
 * Compute an ordered list of up to 10 context-aware suggestions for the
 * current cursor position inside a rule text.
 *
 * Uses the already-settled tokens to infer the grammar context and generates
 * candidates appropriate for that position. The partial token at the cursor
 * is used only for prefix-filtering.
 *
 * @param text - full rule text
 * @param cursorPos - cursor offset (characters)
 * @param ctx - project-level identifiers and scale
 */
export function computeRuleSuggestions(
  text: string,
  cursorPos: number,
  ctx: RuleSuggestionCtx,
): string[] {
  const { elementLabels, categoryNames, functionalityLabels, functionalityN } =
    ctx;

  const before = text.slice(0, cursorPos);
  const endsWithSpace = !before || /\s$/.test(before);
  const allTokens = tokenize(before);

  let partial: string;
  let settled: string[];

  if (endsWithSpace || allTokens.length === 0) {
    partial = "";
    settled = allTokens;
  } else {
    partial = allTokens[allTokens.length - 1];
    settled = allTokens.slice(0, -1);
  }

  const partialLower = partial.toLowerCase();

  // ── Special: partial starts with '.' → attribute dot-completion ───────────
  // The '.' token belongs to `settled` when the user starts typing the
  // attribute name; we intercept partial = "." here too.
  if (partial === "." || partial.startsWith(".")) {
    const attrPart = partial.slice(1).toLowerCase();
    return NODE_ATTRIBUTES.filter((a) => a.startsWith(attrPart))
      .map((a) => "." + a)
      .slice(0, 8);
  }

  // ── Context-specific candidate set ───────────────────────────────────────
  const context = detectRuleContext(settled);

  // Integer level labels 1..N
  const levelNumbers = Array.from({ length: functionalityN }, (_, i) =>
    String(i + 1),
  );

  let candidates: string[];

  switch (context) {
    case "start":
      candidates = [
        "if",
        ...RULE_FUNC_NAMES.map((f) => f + "("),
      ];
      break;

    case "element_in_cond":
      // After 'if' / 'and' / 'or': expect element name or 'not'
      candidates = ["not", ...elementLabels];
      break;

    case "then_element":
      // After 'then': expect the target element name
      candidates = elementLabels;
      break;

    case "prop_target":
      // After 'to' in a propagation rule: expect target element
      candidates = elementLabels;
      break;

    case "in_func_args":
      // Inside 'worst_of(…)' etc.: element names and category names
      candidates = [...elementLabels, ...categoryNames];
      break;

    case "is_or_dot":
      // After an element in the condition: 'is' to compare, '.' to access attribute
      // We list "is" and the dotted-attribute shorthands so the user sees both options.
      candidates = [
        "is",
        ...NODE_ATTRIBUTES.map((a) => "." + a),
      ];
      break;

    case "is_after_then_elem":
      // After the target element in the then-block
      candidates = ["is"];
      break;

    case "attribute":
      // After '.' — show only attribute names (no dot prefix; the dot is in settled)
      candidates = [...NODE_ATTRIBUTES];
      break;

    case "op_or_level": {
      // After 'is' in condition: the user can write an operator first or go straight
      // to a label. Show operators, labels, and numbers together.
      // Group: operators first, then labels, then integers.
      candidates = [
        ...RULE_OPERATORS,
        ...functionalityLabels,
        ...levelNumbers,
      ];
      break;
    }

    case "level_only":
      // After an operator, or after 'then ELEMENT is': only level values
      candidates = [...functionalityLabels, ...levelNumbers];
      break;

    case "continuation":
      // After a condition value — 'and', 'or' add more conditions; 'then' closes it
      candidates = ["and", "or", "then"];
      break;

    case "after_func":
      // After the closing ')' of a propagation function
      candidates = ["propagates"];
      break;

    case "after_propagates":
      candidates = ["to"];
      break;

    default:
      // Broad fallback — show everything
      candidates = [
        "if",
        "then",
        "is",
        "and",
        "or",
        "not",
        "propagates",
        "to",
        ...RULE_FUNC_NAMES,
        ...elementLabels,
        ...categoryNames,
        ...functionalityLabels,
      ];
  }

  // ── Prefix filter ─────────────────────────────────────────────────────────
  // Show all candidates when partial is empty; otherwise prefix-filter and
  // suppress exact matches (the user has already typed that token completely).
  const filtered =
    partial === ""
      ? candidates
      : candidates.filter(
          (c) =>
            c.toLowerCase().startsWith(partialLower) &&
            c.toLowerCase() !== partialLower,
        );

  // Deduplicate and cap
  return [...new Set(filtered)].slice(0, 10);
}

// ---------------------------------------------------------------------------
// Target extraction
// ---------------------------------------------------------------------------

/**
 * Best-effort extraction of the raw target element name from a rule string —
 * no registry access, no tokenisation. Mirrors `extract_target_from_rule` in
 * CASCADE-backend/core/rule_parser.py.
 *
 * Returns the verbatim name string (display label or element ID) on success,
 * or "" when the rule is too incomplete to determine a target yet. The caller
 * resolves the raw name against the element registry.
 *
 * Specific rule:    `if … then TARGET is LEVEL`
 * Propagation rule: `FUNC(…) propagates to TARGET`
 */
export function extractTargetFromRule(ruleText: string): string {
  const trimmed = ruleText.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("if")) {
    const m = trimmed.match(/\bthen\s+(.+?)\s+is\b/i);
    if (m) return m[1].trim();
  }
  if (lower.includes("propagates to")) {
    const m = trimmed.match(/\bpropagates\s+to\s+(\S+(?:\s+\S+)*?)\s*$/i);
    if (m) return m[1].trim();
  }
  return "";
}

// ---------------------------------------------------------------------------
// Context label (for UI hint)
// ---------------------------------------------------------------------------

const CONTEXT_LABELS: Record<RuleContext, string> = {
  start: "start of rule",
  element_in_cond: "element name",
  is_or_dot: "'is' or '.attribute'",
  attribute: "attribute name",
  op_or_level: "operator or level",
  level_only: "level value",
  continuation: "'and' / 'or' / 'then'",
  then_element: "target element",
  is_after_then_elem: "'is'",
  in_func_args: "element or category",
  after_func: "'propagates'",
  after_propagates: "'to'",
  prop_target: "target element",
  unknown: "…",
};

/**
 * Short human-readable label for the current grammar context — shown as a
 * hint below the suggestion popup so the user knows why certain items appear.
 */
export function contextLabel(text: string, cursorPos: number): string {
  const before = text.slice(0, cursorPos);
  const endsWithSpace = !before || /\s$/.test(before);
  const allTokens = tokenize(before);
  const settled = endsWithSpace || allTokens.length === 0
    ? allTokens
    : allTokens.slice(0, -1);
  return CONTEXT_LABELS[detectRuleContext(settled)];
}
