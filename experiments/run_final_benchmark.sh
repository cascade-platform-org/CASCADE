#!/bin/bash
# Final benchmark (2026-07-22 rebuild; capacity+priority canonical set 2026-07-28).
# One invocation per network — the four families (cluster/targeted/tank/source)
# are generated internally, ~60 each; cluster uses 3 internal seeds. CANONICAL:
#   peak_hour demand · reservoirs unbounded / gravity-tanks nominal / pump-fed
#   tanks pipe-limited supply · UNIFORM design-velocity pipe capacity (2.5 m/s,
#   shipped default) · adaptive x8 sweep for ORIENTATION · NO priority ordering
#   (max-min fair share; best precision — priority is a recall lever, ablation
#   only) · reachability removes critical (outlet-closed) sources.
# Writes the CANONICAL final_benchmark.csv. Ablation arms:
#   run_priority_ablation.sh      (--priority-mode contingency) → _priority.csv
#   run_capacity_drill_ablation.sh (--capacity-drill)           → _drill.csv
# See benchmark-protocol.md (same directory).
set -u
cd /home/cristian-curaba/Desktop/CASCADE-v2/CASCADE-backend
EXP=../experiments
CSV=$EXP/final_benchmark.csv
LOG=$EXP/final_benchmark.log
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
echo "FINAL_BENCHMARK_DONE $(date +%H:%M)" | tee -a "$LOG"
