# raw-networks/fram/

FRAM models as FMV (FRAM Model Visualiser) files, `.xfmv`: open any of them in
CASCADE with File → Import → **Import FRAM model (.xfmv)** (ADR-0026). The FRAM
paper's harness (`experiments/fram/`) reads them from here.

A file is tracked only if its licence lets it be redistributed.

| File | Source | Licence |
|---|---|---|
| `grabbe_2022_overtaking.xfmv` | Grabbe, Gales, Höcher, Bengler 2022, *Safety* 8(1):3, doi 10.3390/safety8010003, Supplementary S1 (unchanged) | CC BY 4.0 |

`private/` is never tracked (its own `.gitignore` ignores everything, on every
branch). It holds:

| File | Why it is private |
|---|---|
| `Falegnami2020_WAD_forging.xfmv`, `Simone2025_WAD_aluminium_grinding.xfmv` | shared by A. Tomassi and A. Falegnami for the FRAM paper only: never redistribute, deposit or pass on |
| `fmv-library/` | the FMV example library, <https://github.com/functionalresonance/FRAM_Model_Examples>: published without a licence, so read and cite only; download it there |
