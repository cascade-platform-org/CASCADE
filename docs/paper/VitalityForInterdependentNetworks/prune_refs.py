#!/usr/bin/env python3
r"""Move refs.bib entries the paper does not cite into refs-removed.bib.

Entries are copied VERBATIM, never edited. refs-removed.bib is MERGED, never
overwritten: whatever it already holds is carried forward and the newly moved
entries are appended, so a second run with a shorter KEEP list cannot discard the
first run's output. The script asserts nothing is lost — refs.bib + refs-removed.bib
must total what the two files held before. To restore one entry, move its block
back by hand; to restore all, `cat refs-removed.bib >> refs.bib`.

KEEP must equal exactly the set of keys VitalityForInterdependentNetworks.tex \cite's. Verify with:

    grep -oE '\\cite\{[^}]*\}' VitalityForInterdependentNetworks.tex | sed 's/.*{//;s/}//' | tr ',' '\n' | sort -u

    python prune_refs.py            # report only
    python prune_refs.py --apply    # rewrite refs.bib and refs-removed.bib
"""
from __future__ import annotations

import argparse
import re
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
REFS = HERE / "refs.bib"
REMOVED = HERE / "refs-removed.bib"

KEEP: dict[str, str] = {
    # 1 Introduction / 2 Related work — the dependency-link line
    "parshani_critical_2011": "§1 series reading",
    "bashan_percolation_2011": "§1 series reading, coins 'dependency links'",
    "buldyrev_catastrophic_2010": "§2 founding NoN model",
    "shao_cascade_2011": "§1 parallel reading, conceded",
    "gao_networks_2012": "§2 the network-of-networks generalisation",
    "bachmann_survey_2020": "§1-§2 every field-level claim",
    "kivela_multilayer_2014": "§0 lexicon, layer",
    # 2 Related work — reinforced links
    "zhang_percolation_2024": "§2 reinforced links",
    "li_percolation_2022": "§2 reinforced links",
    # 2 Related work — FDNA and the operability line
    "guariniello_dependency_2013": "§2 FDNA equations",
    "garvey_introduction_2010": "§2 FDNA method",
    "garvey_modelling_2014": "§2 FDNA method",
    "haimes_leontief-based_2001": "§2 antecedent Garvey names",
    # 2 Related work — vitality and process matching
    "koschutzki_centrality_2005": "§2, §4 the vitality class",
    "skibski_vitality_2021": "§2, §4 its axiomatic identity",
    "latora_vulnerability_2005": "§2 infrastructure instance of the class",
    "borgatti_centrality_2005": "§2, §6 process matching",
    "klemm_measure_2012": "§2 ranking from a process",
    "liu_locating_2016": "§2 ranking from a process",
    "hines_topological_2010": "§2 cost of a mismatched process",
    # 3 The model
    "gallo_directed_1993": "§3 directed B-hypergraph",
    "rausand_system_2008": "§0 lexicon, reliability vocabulary",
    # 5 Benchmarks
    "lancichinetti_benchmark_2008": "§5 benchmark design precedent",
    # 6 Applicability
    "rinaldi_identifying_2002": "§6 infrastructure, §0 lexicon",
    "ouyang_review_2014": "§6 where this sits among CI models",
    "orth_what_2010": "§6 flux balance analysis",
    "liu_robustness_2020": "§6 multilayer molecular networks",
    "handorf_expanding_2005": "§6 metabolic network expansion",
}


def parse(text: str) -> tuple[str, list[tuple[str, str]]]:
    """Split a .bib into its preamble and (key, verbatim block) pairs."""
    starts = [m.start() for m in re.finditer(r"^@", text, re.M)]
    if not starts:
        return text, []
    bounds = starts + [len(text)]
    blocks = []
    for i, start in enumerate(starts):
        block = text[start:bounds[i + 1]]
        match = re.match(r"@\w+\{([^,]+),", block)
        if match is None:
            raise SystemExit(f"unparseable entry near offset {start}")
        blocks.append((match.group(1), block))
    return text[:starts[0]], blocks


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="rewrite the files (default: report only)")
    args = ap.parse_args()

    preamble, blocks = parse(REFS.read_text())
    keys = [k for k, _ in blocks]
    _, already = parse(REMOVED.read_text()) if REMOVED.exists() else ("", [])
    before = {k for k, _ in blocks} | {k for k, _ in already}

    # A key may appear twice in the parked file if an earlier run appended a
    # re-exported copy beside the original. Later wins: it came from the newer
    # export. Deduplicating here keeps the file idempotent under repeated runs.
    seen_last = {k: i for i, (k, _) in enumerate(already)}
    deduped = [k for i, (k, _) in enumerate(already) if seen_last[k] != i]
    already = [(k, b) for i, (k, b) in enumerate(already) if seen_last[k] == i]

    duplicates = [k for k in set(keys) if keys.count(k) > 1]
    if duplicates:
        raise SystemExit(f"duplicate bibkeys in refs.bib: {sorted(duplicates)}")

    kept = [(k, b) for k, b in blocks if k in KEEP]
    moved = [(k, b) for k, b in blocks if k not in KEEP]
    assert len(kept) + len(moved) == len(blocks)

    # Anything already parked stays parked, unless KEEP now wants it back. A
    # re-export from Zotero reintroduces entries that were parked earlier, so the
    # merge is keyed: the copy coming out of refs.bib is the fresher metadata and
    # wins, and the stale parked copy is dropped rather than duplicated.
    restored = [(k, b) for k, b in already if k in KEEP]
    fresh = {k for k, _ in moved}
    stale = [k for k, _ in already if k in fresh]
    parked = [(k, b) for k, b in already if k not in KEEP and k not in fresh] + moved
    if restored:
        kept += restored

    missing = [k for k in KEEP if k not in keys]

    print(f"refs.bib: {len(blocks)} entries -> keep {len(kept)}, move {len(moved)}")
    print(f"refs-removed.bib: {len(already)} already parked -> "
          f"{len(parked)} after this run\n")
    if moved:
        print("MOVE to refs-removed.bib:")
        for k, _ in moved:
            print(f"  {k}")
    if restored:
        print("RESTORE to refs.bib (in KEEP, was parked):")
        for k, _ in restored:
            print(f"  {k}")
    if stale:
        print("REFRESHED (parked copy replaced by the one from refs.bib):")
        for k in stale:
            print(f"  {k}")
    if deduped:
        print(f"DEDUPLICATED in refs-removed.bib ({len(deduped)} stale copies "
              f"dropped, newest kept):")
        for k in sorted(set(deduped)):
            print(f"  {k}")
    if missing:
        print("\nIN KEEP BUT ABSENT FROM refs.bib (check these):")
        for k in missing:
            print(f"  {k}")

    # Near-duplicate detection: two entries pointing at the same work.
    by_doi: dict[str, list[str]] = defaultdict(list)
    for k, b in blocks:
        for doi in {m.group(1).strip().lower()
                    for m in re.finditer(r"^\s*doi\s*=\s*\{([^}]*)\}", b, re.M)}:
            by_doi[doi].append(k)
    shared = {d: ks for d, ks in by_doi.items() if len(ks) > 1}
    if shared:
        print("\nSAME DOI ON MORE THAN ONE ENTRY:")
        for doi, ks in shared.items():
            print(f"  {doi}: {', '.join(ks)}")

    repeated = [k for k, b in blocks
                if len(re.findall(r"^\s*doi\s*=", b, re.M)) > 1]
    if repeated:
        print("\nENTRY WITH A REPEATED doi FIELD (BibTeX warns):")
        for k in repeated:
            print(f"  {k}")

    if not args.apply:
        print("\n(report only — pass --apply to rewrite)")
        return

    REFS.write_text(preamble + "".join(b for _, b in kept))
    REMOVED.write_text(
        "% Entries pruned from refs.bib because the 10pp Complex Networks paper\n"
        "% cites none of them. Copied verbatim and never edited, except where a\n"
        "% block is explicitly marked RECONSTRUCTED. Move a block back into\n"
        "% refs.bib to restore it, or `cat refs-removed.bib >> refs.bib` for all.\n"
        "% Regenerate with prune_refs.py --apply after editing its KEEP list.\n\n"
        + "".join(b for _, b in parked))

    after_r = parse(REFS.read_text())[1]
    after_p = parse(REMOVED.read_text())[1]
    after = {k for k, _ in after_r} | {k for k, _ in after_p}
    assert before <= after, f"bibkeys lost: {sorted(before - after)}"
    for label, entries in (("refs.bib", after_r), ("refs-removed.bib", after_p)):
        ks = [k for k, _ in entries]
        dup = sorted({k for k in ks if ks.count(k) > 1})
        assert not dup, f"duplicate bibkeys in {label}: {dup}"
    print(f"\nwrote refs.bib ({len(after_r)}) and refs-removed.bib ({len(after_p)}); "
          f"{len(before)} distinct bibkeys before, {len(after)} after")


if __name__ == "__main__":
    main()
