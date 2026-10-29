"""
Falegnami et al. 2020's Katz ranking (Table 2): reproduction, then topology
(TRANSLATION.md §4b, declared at 7f5c33a; exploratory, for the Discussion).

  (a) the authors' weighted edge list as a node-aligned five-layer multiplex,
      interlayer links of weight 1 between every pair of a node's replicas,
      Katz on the supra-adjacency matrix, summed over replicas;
  (b) the same with every coupling at weight 1 (structure only).

The edge list is private (shared by A. Tomassi and A. Falegnami for this study);
the script stops with a message when it is absent. Output: results/falegnami_katz.csv

Run from the repository root:
    CASCADE-backend/.venv/bin/python experiments/fram/check_falegnami.py
"""
from __future__ import annotations

import csv
import itertools
import sys
from pathlib import Path

import numpy as np
import openpyxl
from scipy.stats import spearmanr

from framkit import readers

RESULTS = Path(__file__).resolve().parent / "results"
LAYERS = ["Input", "Precondition", "Resource", "Control", "Time"]

# Table 2, ranks 1-52, transcribed (spelling as printed; matched ignoring spaces and case).
TABLE_2 = """Train/inform_employees Manage_documentation Check_PPEcondition Fill_chemicals Clean_floor
Mantain Clean_machine Wear_basicPPE Provide_setupMaterial Confirm_Process Check_Integrity_guards&sensors
Wear_gloves Clean_cabinets&panels Make_PPEavailable Wear_taskSpecificPPE Remove_cap Consider_setup_Need
Move_vagonToRail Manage_gaugingInstruments Check_quality Complete_setupOperations Lay_cap Open_fenceGate
Insert_newMolds Supply_electricity Close_coolingWaterTap Design_machine Twist Load_blanks Move_container
Check&clean_coolingWaterFilter Unload_product Check_OilLevel SwitchOff_machine Move_toTwistingArea
Run_machine Forge Move_toForgingArea Transport&heating_blank Wear_glasses Execute_followingProcesses
Notify_setup Assess_plantSafetyManagement Plan_qualityCheck Adopt_legislation Create_managementSystem
Receive_productionOrder Perform_scheduleOperations Define_6s&AutonomousMaintenance Provide_equipment
Remove_molds Clean_pavement&machineMovingParts""".split()


def _key(name: str) -> str:
    return name.replace(" ", "").lower()


def edges() -> tuple[list[str], list[tuple[int, int, int, float]]]:
    """Function names (by the sheet's 1-based ids) and (layer, source, target, weight)."""
    ws = openpyxl.load_workbook(readers.FALEGNAMI_XLSX, data_only=True)["Katz edge list"]
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    names: dict[int, str] = {}
    out = []
    for r in rows:
        if r[0] is None:
            continue
        _, layer_id, _, src, src_name, dst, dst_name, weight = r[:8]
        names[int(src)], names[int(dst)] = src_name, dst_name
        out.append((int(layer_id) - 1, int(src) - 1, int(dst) - 1, float(weight or 0)))
    n = max(names)
    return [names[i + 1] for i in range(n)], out


def katz(es, n: int, weighted: bool, c: float, leaving: bool) -> np.ndarray:
    size = n * len(LAYERS)
    a = np.zeros((size, size))
    for layer, s, t, w in es:
        a[layer * n + s, layer * n + t] = w if weighted else 1.0
    for i in range(n):
        for l1, l2 in itertools.permutations(range(len(LAYERS)), 2):
            a[l1 * n + i, l2 * n + i] = 1.0
    if not leaving:
        a = a.T
    rho = max(abs(np.linalg.eigvals(a)))
    x = np.linalg.solve(np.eye(size) - (c / rho) * a, np.ones(size))
    return x.reshape(len(LAYERS), n).sum(axis=0)


def main() -> None:
    if not readers.FALEGNAMI_XLSX.exists():
        sys.exit("Falegnami 2020 edge list not present (private, TRANSLATION.md §4b).")
    names, es = edges()
    published = {_key(f): i + 1 for i, f in enumerate(TABLE_2)}
    missing = [f for f in names if _key(f) not in published]
    if missing or len(published) != len(names):
        sys.exit(f"Table 2 and the edge list disagree on names: {missing}")
    truth = [published[_key(f)] for f in names]
    top15 = {f for f in names if published[_key(f)] <= 15}
    rows = []
    for weighted, leaving, c in itertools.product((True, False), (True, False), (0.1, 0.5, 0.99999)):
        k = katz(es, len(names), weighted, c, leaving)
        rank = {f: r + 1 for r, f in enumerate(sorted(names, key=lambda f: -k[names.index(f)]))}
        rho = spearmanr([rank[f] for f in names], truth)[0]
        rows.append({"weights": "published" if weighted else "all 1", "walks": "leaving" if leaving else "arriving",
                     "alpha_x_rho": c, "spearman_vs_table2": round(float(rho), 3),
                     "top15_overlap": len({f for f in names if rank[f] <= 15} & top15),
                     "top5": " ".join(sorted(names, key=lambda f: rank[f])[:5])})
    with open(RESULTS / "falegnami_katz.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    for r in rows:
        print(r)
    print(f"couplings {len(es)}, with published weight > 0: {sum(e[3] > 0 for e in es)}")


if __name__ == "__main__":
    main()
