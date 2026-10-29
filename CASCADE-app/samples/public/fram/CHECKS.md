# Checking the core cases in the platform

Open a bundle (File → Open), fire the listed Event(s) from the Action Bar, press Propagate, and read the levels of the listed functions (Inspector, or the node colours). Expected levels come from the same translation the paper's results use; truth is the source paper's. Written by `experiments/fram/export_bundles.py`.

## `rq1_zheng.json` — Zheng 2024 (RQ1)

- **Fire:** Earthquake
- **Expect:** F5 Contact the fire marshal for instructions and actions: **3** (variable); F7 Establish incident command post and advise fire team leaders: **3** (variable); F9 Check extent of fire and escalation potential: **3** (variable); F10 Evaluate the availability of equipment and resources: **3** (variable); F11 Assess flame or heat affected facilities: **3** (variable); F12 Develop response guidelines: **3** (variable); F17 Assemble the fire team with equipment and resource: **3** (variable); F20 Direct fire team to inject foam to the bund wall under fire: **2** (severe); F2 Contact the control room and shift officer for immediate action guidelines: **4** (nominal); F4 Contact fire department: **4** (nominal); F6 Establish if any missing persons at assembly muster and advise fire officer: **4** (nominal); F14 Isolate equipment and commence shutdown of affected and related facilities: **4** (nominal); F15 Pump the product of tanks 52, 53 and 54 to other tanks: **4** (nominal); F16 Respond to the incident area for shutdown supervision: **4** (nominal); F18 All members don firefighting PPE, and SCBAS for firefighters in the hot zone: **3** (variable); F19 Ensure all members don firefighting PPE: **3** (variable)
- **Truth:** Table 2: negative F5, F7, F9, F10, F11, F12, F17, F20; positive F2, F4, F6, F14, F15, F16, F18, F19 (v2 misses F18, F19: their staff adapt)

## `c8_zheng_two_way_updates.json` — C8: Simultaneously updating seismic Natech accident-related info…

- **Fire:** the Event, then compare with the matching rq1_ bundle
- **Expect:** F7 Establish incident command post and advise fire team leaders: **4** (nominal); F9 Check extent of fire and escalation potential: **4** (nominal); F10 Evaluate the availability of equipment and resources: **4** (nominal); F11 Assess flame or heat affected facilities: **4** (nominal); F12 Develop response guidelines: **4** (nominal) — verdict in the paper: **agree**
- **Truth:** the claim says: improve

## `c9_zheng_cancel_f5_mutual_aid.json` — C9: cancel the unnecessary functions F5 ... dispatch more firefi…

- **Fire:** the Event, then compare with the matching rq1_ bundle
- **Expect:** F20 Direct fire team to inject foam to the bund wall under fire: **4** (nominal) — verdict in the paper: **agree**
- **Truth:** the claim says: F20 nominal
