#!/bin/bash
# CAPACITY ABLATION (experiments §S2, ATTEMPTS.md §12): identical to the
# canonical run_final_benchmark.sh (uniform capacity, no priority) but pipe
# capacity is sized from the per-pipe hydraulic SWEEP (area x min(v_peak x
# margin, max_v)) instead of the shipped uniform design velocity — the
# pre-2026-07-27 method (--capacity-drill). Result: the drill is WORSE than the
# flat 2.5 m/s constant (pooled F1 0.737 drill vs 0.794 uniform, precision 0.599
# vs 0.682, FMS 0.905 vs 0.918) — which is why uniform velocity is the default.
set -u
cd /home/cristian-curaba/Desktop/CASCADE-v2/CASCADE-backend
EXP=../experiments/aqueducts
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
    --contingency-exhaustive-trunk --priority-mode none \
    --demand-mode peak_hour --capacity-drill --csv "$CSV" >>"$LOG" 2>&1 \
    || echo "  FAILED: $net" | tee -a "$LOG"
done
echo "CAPACITY_DRILL_ABLATION_DONE $(date +%H:%M)" | tee -a "$LOG"
