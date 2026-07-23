#!/bin/bash
# Uniform-priority ablation: identical setup to run_final_benchmark.sh but
# --priority-mode none, for the paper's [none prec] / [FP cut] placeholders.
# Faster than the contingency run (single-tier fair-share, no 70 priority solves).
set -u
cd /home/cristian-curaba/Desktop/CASCADE-v2/CASCADE-backend
EXP=../experiments
CSV=$EXP/final_benchmark_none.csv
LOG=$EXP/final_benchmark_none.log
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
    --demand-mode peak_hour --csv "$CSV" >>"$LOG" 2>&1 \
    || echo "  FAILED: $net" | tee -a "$LOG"
done
echo "NONE_RUN_DONE $(date +%H:%M)" | tee -a "$LOG"
