/**
 * manual-parse.mjs — the User Manual's markdown, turned into data.
 *
 * `docs/project/user-manual.md` is the single source for the manual. The
 * in-app panel used to be a hand-written copy of it in JSX, which is two files
 * that must say the same thing and therefore eventually do not. This parser is
 * the one direction that copy now travels: markdown in, a plain object out,
 * which `build-user-manual.mjs` writes to `lib/generated/user-manual.ts` and
 * the panel renders with the app's own styling.
 *
 * It is written against the subset of markdown the manual actually uses —
 * `##`/`###` headings, paragraphs, GFM tables, fenced code, ordered and
 * unordered lists, blockquotes, and inline `code` / **strong** / *em* /
 * [links] / `<br />`. Anything else **throws**: a silently dropped paragraph
 * is exactly the failure this file exists to prevent. Extending the manual
 * with new syntax means extending this parser, which the parity test
 * (`lib/manual/user-manual.test.ts`) forces you to notice.
 *
 * Plain ESM with no dependencies so it runs from `npm run docs:manual` and
 * imports straight into vitest. Everything before the first `##` — the title,
 * the index, the tutorial list — is the panel's own chrome and is skipped.
 */

/** Anchor id for a section, matching the markdown's own heading slugs. */
function slug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Inline markdown → spans. Ordered so the first match wins: code before
 * anything else (a backtick span is literal), then links, strong, em.
 */
export function parseInline(text) {
  const spans = [];
  const pattern =
    /(`[^`]+`)|(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(<br\s*\/?>)/g;
  let last = 0;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) spans.push({ kind: "text", text: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("`")) {
      spans.push({ kind: "code", text: tok.slice(1, -1) });
    } else if (tok.startsWith("[")) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      spans.push({ kind: "link", text: label, href });
    } else if (tok.startsWith("**")) {
      spans.push({ kind: "strong", text: tok.slice(2, -2) });
    } else if (tok.startsWith("<br")) {
      spans.push({ kind: "break" });
    } else {
      spans.push({ kind: "em", text: tok.slice(1, -1) });
    }
    last = m.index + tok.length;
  }
  if (last < text.length) spans.push({ kind: "text", text: text.slice(last) });
  return spans.filter((s) => s.kind !== "text" || s.text !== "");
}

/** One `| a | b |` row into its cells, with the outer pipes dropped. */
function tableCells(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
const isTableDivider = (line) => /^\s*\|[\s:|-]+\|\s*$/.test(line);

/**
 * Markdown → `{ sections: [{ id, n, title, blocks }] }`.
 *
 * A block is one of: paragraph, callout (a `>` quote), table, code, list, or
 * sub (a `###` heading and everything under it until the next heading).
 */
export function parseManual(markdown) {
  const lines = markdown.split("\n");
  const sections = [];
  let section = null;
  let sub = null;

  /** Blocks go into the open `###` when there is one, else into the section. */
  const sink = () => (sub ? sub.blocks : section.blocks);

  let i = 0;
  // Skip the front matter: title, index, tutorial list — all panel chrome.
  while (i < lines.length && !lines[i].startsWith("## ")) i++;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "" || line.trim() === "---") {
      i++;
      continue;
    }

    if (line.startsWith("## ")) {
      const heading = line.slice(3).trim();
      const m = /^(\d+)\.\s+(.*)$/.exec(heading);
      if (!m) throw new Error(`Section heading must be numbered: "${heading}"`);
      section = { id: slug(m[2]), n: Number(m[1]), title: m[2], blocks: [] };
      sections.push(section);
      sub = null;
      i++;
      continue;
    }

    if (!section) throw new Error(`Content before the first section: "${line}"`);

    if (line.startsWith("### ")) {
      sub = { type: "sub", title: line.slice(4).trim(), blocks: [] };
      section.blocks.push(sub);
      i++;
      continue;
    }

    if (line.startsWith("#")) throw new Error(`Unsupported heading depth: "${line}"`);

    // Fenced code.
    if (line.startsWith("```")) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      if (i >= lines.length) throw new Error("Unterminated code fence");
      i++; // closing fence
      sink().push({ type: "code", text: body.join("\n") });
      continue;
    }

    // GFM table: a header row, a divider, then body rows.
    if (isTableRow(line) && isTableDivider(lines[i + 1] ?? "")) {
      const head = tableCells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(tableCells(lines[i]).map(parseInline));
        i++;
      }
      sink().push({ type: "table", head, rows });
      continue;
    }

    // Lists — ordered or unordered, one level, continuation lines indented.
    const bullet = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (bullet) {
      const ordered = /\d/.test(bullet[2]);
      const items = [];
      while (i < lines.length) {
        const m2 = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (m2) {
          items.push(m2[3]);
          i++;
        } else if (/^\s+\S/.test(lines[i] ?? "") && items.length > 0) {
          items[items.length - 1] += " " + lines[i].trim(); // wrapped line
          i++;
        } else {
          break;
        }
      }
      sink().push({ type: "list", ordered, items: items.map(parseInline) });
      continue;
    }

    // Blockquote → callout.
    if (line.startsWith("> ")) {
      const body = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        body.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      sink().push({ type: "callout", spans: parseInline(body.join(" ").trim()) });
      continue;
    }

    // Paragraph: everything up to a blank line or the next block opener.
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith("```") &&
      !lines[i].startsWith("> ") &&
      !isTableRow(lines[i]) &&
      !/^(\s*)([-*]|\d+\.)\s+/.test(lines[i])
    ) {
      para.push(lines[i].trim());
      i++;
    }
    const text = para.join(" ").trim();
    if (text === "") continue;
    // "N.B. …" is the manual's own way of flagging a caveat; it reads as a
    // callout in the panel rather than as one more paragraph.
    if (text.startsWith("N.B.")) {
      sink().push({ type: "callout", spans: parseInline(text.replace(/^N\.B\.\s*/, "")) });
    } else {
      sink().push({ type: "paragraph", spans: parseInline(text) });
    }
  }

  if (sections.length === 0) throw new Error("No sections found");
  return { sections };
}
