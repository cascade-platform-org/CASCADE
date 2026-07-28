#!/bin/bash
# PRIORITY ABLATION (2026-07-28): the canonical config (uniform capacity, no
# priority) with the cycle-aware contingency priority turned ON. Quantifies
# priority as a RECALL LEVER: it lifts pooled recall 0.95->0.98 at a precision
# cost (0.68->0.63) — not a precision fix. Writes final_benchmark_priority.csv;
# compare against the canonical final_benchmark.csv with paper_numbers.py.
set -u
cd /home/cristian-curaba/Desktop/CASCADE-v2/CASCADE-backend
EXP=../experiments
CSV=$EXP/final_benchmark_priority.csv
LOG=$EXP/final_benchmark_priority.log
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
    --demand-mode peak_hour --csv "$CSV" >>"$LOG" 2>&1 \
    || echo "  FAILED: $net" | tee -a "$LOG"
done
echo "PRIORITY_ABLATION_DONE $(date +%H:%M)" | tee -a "$LOG"
