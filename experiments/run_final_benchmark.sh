#!/bin/bash
# Final benchmark (2026-07-22 rebuild; capacity method updated 2026-07-27).
# One invocation per network — the four families (cluster/targeted/tank/source)
# are generated internally, ~60 each; cluster uses 3 internal seeds. Setup:
#   peak_hour demand · reservoirs unbounded / gravity-tanks nominal / pump-fed
#   tanks pipe-limited supply · UNIFORM design-velocity pipe capacity (2.5 m/s,
#   the shipped default — no capacity flag needed) · adaptive x8 sweep for
#   ORIENTATION · cycle-aware severity contingency priorities · reachability
#   removes critical (outlet-closed) sources.
# Writes the CANONICAL final_benchmark.csv. The sweep-drill capacity ablation
# (the old method) is run_capacity_drill_ablation.sh → final_benchmark_drill.csv.
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
    --contingency-exhaustive-trunk --priority-mode contingency \
    --demand-mode peak_hour --csv "$CSV" >>"$LOG" 2>&1 \
    || echo "  FAILED: $net" | tee -a "$LOG"
done
echo "FINAL_BENCHMARK_DONE $(date +%H:%M)" | tee -a "$LOG"
