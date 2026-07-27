#!/bin/bash
# CAPACITY ABLATION (experiments §S2, ATTEMPTS.md §12): identical to
# run_final_benchmark.sh but pipe capacity is sized from the per-pipe hydraulic
# SWEEP (area x min(v_peak x margin, max_v)) instead of the shipped uniform
# design velocity — the pre-2026-07-27 method (--capacity-drill). Quantifies
# what the elaborate per-pipe capacity discovery buys over a flat 2.5 m/s rule
# of thumb. Result: essentially nothing (pooled F1 0.778 drill vs 0.770
# uniform, FMS 0.921 vs 0.926) — which is why uniform velocity is the default.
set -u
cd /home/cristian-curaba/Desktop/CASCADE-v2/CASCADE-backend
EXP=../experiments
CSV=$EXP/final_benchmark_drill.csv
LOG=$EXP/final_benchmark_drill.log
rm -f "$CSV" "$LOG"
NETWORKS="Net1 Net2 Net3 \
../raw-networks/aqueducts/Cassacco_totale.inp \
../raw-networks/aqueducts/Tarcento_totale.inp \
../raw-networks/aqueducts/Zampis.inp \
../raw-networks/aqueducts/Modena.inp \
../raw-networks/aqueducts/CTown.inp"

for net in $NETWORKS; do
  echo "=== $(date +%H:%M) starting $net ===" | tee -a "$LOG"
  python3 scripts/validate_faithfulness.py --networks "$net" --seed 1 \
    --contingency-exhaustive-trunk --priority-mode contingency \
    --demand-mode peak_hour --capacity-drill --csv "$CSV" >>"$LOG" 2>&1 \
    || echo "  FAILED: $net" | tee -a "$LOG"
done
echo "CAPACITY_DRILL_ABLATION_DONE $(date +%H:%M)" | tee -a "$LOG"
