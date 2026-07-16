#!/bin/bash
# Headline re-run for the paper's simple story (2026-07-16):
# shipped importer (capacity margin x2 + full-duplex + injection wells),
# corrected ground truth (severed-component fix), engine default allocation
# (tiered fair-share), NO derived priorities (--priority-mode none).
cd /home/cristian-curaba/Desktop/CASCADE-v2/CASCADE-backend
EXP=../experiments
NETWORKS="Net1 Net3 ../raw-networks/aqueducts/Cassacco_totale.inp ../raw-networks/aqueducts/Tarcento_totale.inp ../raw-networks/aqueducts/Zampis.inp"
for seed in 1 2 3; do
  for net in $NETWORKS; do
    python3 scripts/validate_faithfulness.py --networks "$net" --situations 30 --seed $seed \
      --contingency-exhaustive-trunk --contingency-samples 20 --contingency-trunk-pairs 30 \
      --priority-mode none \
      --csv $EXP/headline_fairshare_none.csv
  done
done
echo HEADLINE_DONE
