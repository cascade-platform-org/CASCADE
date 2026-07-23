#!/bin/bash
# Re-run ONLY the 3 networks whose tanks reclassify under the 2026-07-23 pump-fed
# tank supply fix (Net1, Tarcento, CTown). The other 5 (Net2/Net3/Cassacco/
# Zampis/Modena) have no pump-fed tanks, so their supply model is unchanged and
# their original rows are reused. Same flags as run_final_benchmark.sh.
set -u
cd /home/cristian-curaba/Desktop/CASCADE-v2/CASCADE-backend
EXP=../experiments
CSV=$EXP/final_benchmark_fixed.csv
LOG=$EXP/final_benchmark_fixed.log
rm -f "$CSV" "$LOG"
NETWORKS="Net1 \
../raw-networks/aqueducts/Tarcento_totale.inp \
../raw-networks/aqueducts/CTown.inp"

for net in $NETWORKS; do
  echo "=== $(date +%H:%M) starting $net ===" | tee -a "$LOG"
  python3 scripts/validate_faithfulness.py --networks "$net" --seed 1 \
    --contingency-exhaustive-trunk --priority-mode contingency \
    --demand-mode peak_hour --csv "$CSV" >>"$LOG" 2>&1 \
    || echo "  FAILED: $net" | tee -a "$LOG"
done
echo "PUMPFED_RERUN_DONE $(date +%H:%M)" | tee -a "$LOG"
