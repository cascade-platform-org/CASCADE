#!/usr/bin/env python3
"""Regenerate complenet-refs.bib (the lean, cited bibliography the paper is
compiled against) from complexnetworkpaper.bib (the full Zotero master).

Single source of truth = complexnetworkpaper.bib. This script:
  1. reads the \\cite keys actually used in FlowAllocationModuleForHydraulic.tex;
  2. MERGES: any cited entry that currently lives only in complenet-refs.bib
     (e.g. a reference added straight to the lean file) is folded back into
     the master, so the master stays the complete superset;
  3. pulls exactly the cited entries from the master and STRIPS heavy fields
     (url, doi, abstract, file, ...) that spmpsci.bst would print and that
     blow the venue's page budget;
  4. writes complenet-refs.bib with only those cited entries.

Uncited entries are dropped (removing redundancy). A cited key found in
neither bib aborts with a clear error rather than vanishing silently.

Run from anywhere:  python3 build_refs.py
"""
from __future__ import annotations
import re
import sys
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
MASTER = HERE / "complexnetworkpaper.bib"
TEX = HERE / "FlowAllocationModuleForHydraulic.tex"
OUT = HERE / "complenet-refs.bib"

# Fields dropped from every generated entry: heavy payloads and anything
# spmpsci.bst renders into the printed reference list (kept lean for the cap).
STRIP = {
    "url", "doi", "abstract", "file", "keywords", "note", "urldate",
    "issn", "isbn", "shorttitle", "arxivid", "language", "langid",
    "copyright", "annote", "month",
}


def cited_keys(tex: str) -> list[str]:
    """Ordered, de-duplicated \\cite keys in the tex, ignoring % comments."""
    clean_lines = []
    for line in tex.splitlines():
        out = []
        i = 0
        while i < len(line):
            if line[i] == "%" and (i == 0 or line[i - 1] != "\\"):
                break
            out.append(line[i])
            i += 1
        clean_lines.append("".join(out))
    text = "\n".join(clean_lines)
    keys: list[str] = []
    for m in re.finditer(r"\\cite[a-zA-Z]*\s*(?:\[[^\]]*\])?\{([^}]*)\}", text):
        for k in m.group(1).split(","):
            k = k.strip()
            if k and k not in keys:
                keys.append(k)
    return keys


def parse_entries(bib: str) -> dict[str, tuple[str, str, str]]:
    """Map key -> (entrytype, raw_entry_text, body_after_key) by brace match."""
    entries: dict[str, tuple[str, str, str]] = {}
    n = len(bib)
    i = 0
    while i < n:
        if bib[i] != "@":
            i += 1
            continue
        m = re.match(r"@(\w+)\s*\{\s*([^,]+),", bib[i:])
        if not m:
            i += 1
            continue
        etype = m.group(1)
        key = m.group(2).strip()
        brace_open = i + bib[i:].index("{")
        depth = 0
        j = brace_open
        while j < n:
            if bib[j] == "{":
                depth += 1
            elif bib[j] == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        raw = bib[i:j + 1]
        inner = bib[brace_open + 1:j]
        body = inner[inner.index(",") + 1:]  # drop the leading "key,"
        entries[key] = (etype, raw, body)
        i = j + 1
    return entries


def parse_fields(body: str) -> list[tuple[str, str]]:
    """Yield (name_lower, raw_value_with_delimiters) pairs from an entry body."""
    fields: list[tuple[str, str]] = []
    n = len(body)
    i = 0
    while i < n:
        m = re.match(r"\s*([A-Za-z][\w-]*)\s*=\s*", body[i:])
        if not m:
            break
        name = m.group(1).lower()
        i += m.end()
        if i >= n:
            break
        if body[i] == "{":
            depth = 0
            s = i
            while i < n:
                if body[i] == "{":
                    depth += 1
                elif body[i] == "}":
                    depth -= 1
                    if depth == 0:
                        i += 1
                        break
                i += 1
            val = body[s:i]
        elif body[i] == '"':
            s = i
            i += 1
            while i < n and body[i] != '"':
                i += 1
            i += 1
            val = body[s:i]
        else:
            s = i
            while i < n and body[i] != ",":
                i += 1
            val = body[s:i].strip()
        fields.append((name, val))
        while i < n and body[i] in ", \n\t\r":
            i += 1
    return fields


def main() -> None:
    master_text = MASTER.read_text()
    all_keys = re.findall(r"@\w+\{\s*([^,]+),", master_text)
    dup_keys = sorted({k for k in all_keys if all_keys.count(k) > 1})
    if dup_keys:
        print("WARNING: duplicate keys in master (last one wins): "
              + ", ".join(dup_keys), file=sys.stderr)
    master = parse_entries(master_text)
    refs = parse_entries(OUT.read_text()) if OUT.exists() else {}
    keys = cited_keys(TEX.read_text())

    # Step 2 — merge: fold cited entries that live only in the lean file back
    # into the master, so the master remains the complete source of truth.
    folded = []
    for k in keys:
        if k not in master and k in refs:
            master[k] = refs[k]
            folded.append(refs[k][1])  # raw text
    if folded:
        with MASTER.open("a", encoding="utf-8") as fh:
            fh.write("\n% --- folded in from complenet-refs.bib by build_refs.py ---\n")
            fh.write("\n\n".join(folded) + "\n")
        print(f"Merged {len(folded)} entry(ies) into {MASTER.name}.")

    missing = [k for k in keys if k not in master]
    if missing:
        sys.exit("ERROR: cited key(s) in neither bib: " + ", ".join(missing))

    # Step 3/4 — emit cited-only, field-stripped entries.
    lines = [
        "% GENERATED by build_refs.py from complexnetworkpaper.bib — DO NOT hand-edit.",
        "% Add or update references in the master (complexnetworkpaper.bib), then run:",
        "%     python3 build_refs.py",
        "% Contains only entries \\cite'd in FlowAllocationModuleForHydraulic.tex, heavy fields stripped.",
        "",
    ]
    for key in keys:
        etype, _raw, body = master[key]
        kept = [(n, v) for (n, v) in parse_fields(body) if n not in STRIP]
        lines.append(f"@{etype}{{{key},")
        for name, val in kept:
            lines.append(f"  {name} = {val},")
        lines.append("}")
        lines.append("")
    OUT.write_text("\n".join(lines), encoding="utf-8")

    dropped = sorted(set(refs) - set(keys))
    print(f"Wrote {OUT.name}: {len(keys)} cited entries "
          f"(master now holds {len(master)}).")
    if dropped:
        print(f"Dropped {len(dropped)} uncited entry(ies): {', '.join(dropped)}")


if __name__ == "__main__":
    main()
