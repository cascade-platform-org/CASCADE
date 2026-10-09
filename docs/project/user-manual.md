# CASCADE — User Manual

> **This file is the manual.** The Help button in the Topbar renders it:
> `npm run docs:manual` parses it into `CASCADE-app/lib/generated/user-manual.ts`,
> which `components/help/user-manual.tsx` styles. Edit here, regenerate, commit
> both — a stale generated file fails `lib/manual/user-manual.test.ts`.

1. [Setting up an element](#1-setting-up-an-element) ·
2. [Propagation](#2-propagation) ·
3. [Rules](#3-rules) ·
4. [Running a scenario](#4-running-a-scenario) ·
5. [Testing an intervention](#5-testing-an-intervention) ·
6. [Analysis results](#6-analysis-results) ·
7. [Saving and loading](#7-saving-and-loading) ·
8. [Server and roles](#8-server-and-roles) ·
9. [Temporal Simulation](#9-temporal-simulation) ·
10. [Keyboard shortcuts](#10-keyboard-shortcuts)

**Platform Tutorials**

**Guided tour** — the core loop, on a worked example.
**Build a model** — build one that cascades, on a new empty canvas.
**Customize the Propagation** — change one declaration at a time, and re-propagate to read what it did.
**Analyse and decide** — causality, time, the Scorecard, the Analysis Module and repair ranking.

---

## 1. Setting up an element

Select a node or edge and fill in the Inspector — the panel on the right. 
An edge `a → b` means **a supplies b**. Common attributes with nodes have the same meaning.

N.B. **Supply Capacity** appears once the node carries a Category (or is a Source), **Category Dependency Profiles**  appears once a Categorized node reaches it,  and **Canvas Membership** once the project has a second Canvas.

                      
### Identity

| Field                | Meaning                                                                                                                                                                                                                                              | Consequence                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Label**      | The name shown on the canvas.                                                                                                                                                                                                                        | Rules can reference it.<br />Appears in the analysis.                                                                                         |
| **Node Type**  | Source / Infrastructure / Service / Personnel.                                                                                                                                                                                                       | Rapid visual cues.                                                                                                                            |
| **Categories** | The services the node provide (`e.g. water`,`manager`, …). To represent a resource flowing in a capacited infrastructure adopt **SourceToDemands** Category. To represent logical interdependencies, adopt **Requisite** Category. | Determines how the disservice propagates. See Section Propagation for details.                                                                            |

### Functionality

The element's current condition. A **Reset** clears every field in this section.

| Field                                       | Meaning                                                   | Consequence                                                                                                                                                                   |
| ------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Functionality** `1–N`            | `1` worst, `N` fully operational.                     | Sets the colour on the canvas representing disservice. Edit it by hand to pose a what-if                                                      |
| **Functionality Time** (hours)        | Hours left on a backup that is preserving the functionality.   | When above zero the node keeps its functionality but pulses with an amber ring on the canvas. The countdown moves only on a**Temporal Jump** ; at zero the element drops to `1`. |
| **Direct damage** (physical breakage) | The element is broken requiring intervention. | Set by an **Hazard**, or by hand. It draws a crack on the node and it is considered in the repair ranking |
| **Expected repair time** (hours)      | An estimated time for fixing.| Feeds the repair ranking's value-per-hour; it doesn't propagate.                                                                                                                |

### Capacities

What the node can **produce** and what it can **pass on** — two different numbers, both read by the flow propagation (§2.2).

| Field                                            | Meaning                                   | Consequence                                                                                                                                                                                                            |
| ------------------------------------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Supply Capacity** `{category: amount}` | The amount of demand the node can supply to the same-category nodes. Makes the node a source of that category. | Scaled by its current functionality. See Section Propagation for details. |
| **Throughput Capacity** (per category) | How much can pass **through** the node on its way elsewhere. Shown for `SourceToDemands` categories only. | Scaled by its current functionality, exactly like an edge. Left empty it defaults to the largest supply declared for that category — finite, so a degraded node still throttles. |
### Socioeconomic Values

| Field                              | Meaning                                              | Consequence                                                                                                                                                                 |
| ---------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Importance** `0–1`      | How much this node counts. Defaults to**0.5**. | No effect on propagation. It sets the size the node is drawn at, can weight the analysis results. |
| **Cost of disservice / day** | Money lost per day while degraded.                   | Can weight the analysis results.                                                  |

### Category Dependency Profiles

Appears as one block per Category reaching the node.

| Field                                                    | Meaning                                                                                | Consequence                                                                                                                                                                                                  |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Dependency level** `1–N`                      | How hard a parent-node disservice affects the node.                             | `N` (the default) represents the maximum dependency. `1` means this category can never degrade the node. |
| **Has backup** + **Backup duration (hours)** | The node holds its current functionality (instead of degrading), and starts a countdown.          | The drop can be triggered via a **Temporal Jump**. On expiry the node goes straight to critical.                   |
| **Demand**                                         | The quantity, per-category, the node requires and consumes in the flow propagation.| Only nodes with`demand > 0` are considered in the flow allocation.                                                                     |
| **Priority** `1–10` (default 5)                 | Who gets served first when supply is insufficient.                                            | Only used by`SourceToDemands` categories. Equal priorities share the shortage; a higher priority takes its full demand before lower ones get anything.                                                     |

### Vulnerability Levels

One entry per Event, on nodes and on edges. It sets how the Event affects the element.

| Vulnerability | At N=3                  |
| ------------- | ----------------------- |
| absent or 0   | untouched by that Event |
| 1             | `operational_warning` |
| 2             | `critical`            |

Hazard Events can also activate the element's **Direct damage**.

### Rules

The rules targetting this element which customize the propagation. See Section Rules for details.

### Properties

Free key/value attributes carried with the element — a population, an asset
code, a pressure. Numeric ones become weighting options for the Operativity Score, and Rules can read them. The engine ignores the rest.

### Canvas Membership

Shown once the project has a second Canvas: pick a **Target canvas**, then **Copy**  or **Move** to another Canvas. The same element can be shown on two Canvases through the **Copy** button.

## 2. Propagation

A Propagation asks one question: given what is damaged now, what else stops
working? It runs on the server, in rounds, until no element worsens further.

Each round, each element: **propose → guard → commit**.

| Phase             | What happens                                                                 | Steered by                                   |
| ----------------- | ---------------------------------------------------------------------------- | -------------------------------------------- |
| **Propose** | Two passes compute a candidate Functionality; the worse of the two is kept.  | Categories, edges, Supply Capacity, Demand   |
| **Guard**   | The candidate is attenuated, deferred, or overridden.                        | Dependency level, Has backup, Specific rules |
| **Commit**  | `worst_of(current, candidate)` — a run only degrades, never repairs.       | —                                            |

### 2.1 Propose — the Requisite pass

Runs for **every** element, every round, whatever Category Types are involved.
It answers "is what I need still there?" without counting quantities.

1. Each incoming edge `u → v` delivers `worst_of(u functionality, edge functionality)`.
2. Deliveries are grouped by the category of the parent that sent them.
3. **Within a category: `best_of`** — suppliers of the same service are
   alternatives, one healthy supplier is enough.
4. **Across categories: `worst_of`** — different services are all required.

So a node fed by two power stations survives losing one; a node fed by power
*and* water follows whichever of the two is worse.

### 2.2 Propose — the flow pass

Runs **in addition** for elements with `Demand > 0` in a `SourceToDemands`
category. It answers "how much actually arrives?".

- Supply is allocated from every source of that category through the graph at
  once, limited by each source's **Supply Capacity** and by the **Throughput
  Capacity** of every node and edge it passes through.
- A degraded element passes less: the top level passes 100 %, the bottom level
  0 %, and each level in between `(functionality − 0.5) / N` of its capacity.
- When supply is short, **Priority** decides who is served first. Equal
  priorities share the shortfall fairly; a higher priority is served in full
  before lower ones get anything.
- The served ratio becomes a level: `max(1, ⌈delivered / demand × N⌉)`. Fully
  served → `N`; nothing delivered → `1`.

An element with no Demand is untouched by this pass. An element with both passes
active takes the worse of the two.

| Category Type              | Question it answers        | Reads                                            |
| -------------------------- | -------------------------- | ------------------------------------------------ |
| **Requisite**        | Is the service present?    | edges, parent Functionality                      |
| **SourceToDemands**  | Is there enough of it?     | Supply Capacity, Throughput Capacity, Demand, Priority |

`SourceToDemands` elements are subject to the Requisite pass as well — quantity
does not replace presence.

### 2.3 Guard — in this fixed order

1. **Dependency level.** `candidate + (N − dependency level)`, never above the
   element's current level. `N` passes the drop whole, `1` cancels it,
   intermediate values soften it by that many levels.
2. **Has backup**, per category. A proposed drop coming from a backed category
   is not applied: its duration is written to **Functionality Time** and the drop
   waits for a **Temporal Jump**. A drop coming from an *unbacked* category still
   commits this round — a reserve for water does not keep the power on. With
   several backups running, the shortest countdown wins, and an existing
   countdown is only ever shortened.
3. **Specific rules** — highest priority. A firing rule replaces the result and
   overrides both the attenuation and the backup deferral; a rule-forced
   critical goes critical now, and the pending countdown is cleared.

### 2.4 Commit and convergence

The element takes `worst_of(current, result)`. Within one run Functionality only
falls — nothing recovers, which is what makes the rounds terminate. Rounds
repeat until no element worsens.

On a large model the engine may stop early and return
`convergence not reached` as a warning. The partial result is merged like any
other: it can be read, undone, and saved to the Scorecard.

### 2.5 Causality

Every degraded element records a **responsibility share** — who caused this, and
in what proportion — taken from the mechanism that produced its final level.
The Inspector states it in words, and the repair ranking is computed from it.

| Mechanism           | Blame goes to                                          |
| ------------------- | ------------------------------------------------------ |
| Requisite pass      | the failed upstream elements, split evenly             |
| Flow pass           | the degraded same-category elements feeding it         |
| Event               | the Event                                              |
| Specific rule       | the elements the rule names, split evenly              |

### 2.6 Scope

*Local* propagates the active Canvas only and ignores edges leaving it;
*Global* propagates every Canvas and follows them. **An inter-canvas cascade
appears only under Global.** The scope selector sits in front of Propagate,
Simulate and Analyse, and sets the scope of all three.

## 3. Rules

Rules cover what the graph alone cannot express. The grammar reference is the
[Rules Manual](cascade:rules-manual) window in the app; this is about when and why.

Write them in the **Active Rules** window — the Inspector's *Add rule* opens it,
and so does the Rules counter in the status bar. It suggests names, operators
and levels as you type, and aims at whatever element is selected. The dropdown
in its header picks which canvas's rules you are looking at, starting on the one
you are on; *All canvases* shows every rule in the project.

### 3.1 When you need one

Without any rule the engine already assumes (§2):

- several suppliers of the **same** category → **best of** them;
- several **different** categories → **worst of** them;
- partial tolerance is `Dependency level`, not a rule;
- a delayed failure is `Has backup`, not a rule.

Write a rule when the real system contradicts one of those. Many rules usually
means the model wants a different Category Type or an extra element instead.

### 3.2 The three kinds

| Kind                       | Shape                                       | What it changes                                          |
| -------------------------- | ------------------------------------------- | -------------------------------------------------------- |
| **Intracategorical** | `op(a, b, …) propagates to target`       | how the target combines suppliers **within one** category |
| **Intercategorical** | `op(cat1, cat2, …) propagates to target` | how the target combines its **different** categories      |
| **Specific**         | `if <condition> then <target> is <level>` | forces an outcome when a named situation holds            |

The kind is inferred: starting with `if` makes it Specific; otherwise naming a
**category** in the arguments makes it Intercategorical, else Intracategorical.
The target takes no category suffix.

Operators: `worst_of`, `best_of`, `average_of`, `median_of`, `majority_of`.

Conditions take `and` / `or` / `not`, parentheses, any attribute after a dot
(default `functionality`), and `< <= > >= = ≠`.

### 3.3 Examples

**Degrade gradually instead of all-or-nothing.** A city has three road
approaches. The default keeps it fully connected while any one is open; real
traffic congests as routes close:

```
average_of(Udine Access, Aquileia Access, Cividale Access)
  propagates to Palmanova transport
```

One route `critical`, two `operational` → `⌊(1+3+3)/3⌋ = 2`.

**Let one service cover for another.** A town copes with losing power *or* water
while the roads are open; it fails only when transport is impaired **and** one
utility is too:

```
worst_of(
  best_of(Jalmicco electric, Jalmicco transport),
  best_of(Jalmicco water,    Jalmicco transport)
) propagates to Jalmicco
```

**Hold an element up under a standing agreement.** A water source depends on
power, but a protocol between the two operators keeps it running while both are
functioning:

```
if water Operator.protocol_active is True
and water Operator is operational
and electric Operator is operational
then Fauglis water Source is operational
```

The first condition reads a custom attribute added under **Properties**; the
others read live Functionality. When either operator degrades the rule stops
firing and normal propagation takes over.

### 3.4 What bites people

- A rule that would **improve** an element does nothing: the commit is
  `worst_of` (§2.4).
- In an intracategorical rule the listed elements only **select the category** —
  the operator then governs *all* of the target's suppliers in it. Name the
  category directly to be unambiguous: `worst_of(water) propagates to tank`.
- A misspelt level label or an unknown element name makes the rule **ignored
  with a warning**, not an error. Read the warnings after a Propagation.

## 4. Running a scenario

1. **Define the Event** in Config → Events, as a **Hazard** (physical damage,
   needs repair), a **Disservice** (no damage, clears with its cause) or a
   **Restorative** Event (green: a repair or a recovery). Set `Vulnerability
   levels` on the elements a Hazard or Disservice reaches; a Restorative Event
   has none and acts only through its operations, and an element it brings back
   to full Functionality loses its cause. **Attribute operations** let
   an Event change a value relative to what it is — halve a supply, add 5 to a
   demand, cap a capacity — on one element or on every element a filter
   selects (kind, canvas, node type, category, part of the label, then tick
   the matches). *× of* multiplies the value by what the same element holds in
   another field just before, for a rule on a remembered value: "in June, pay
   half the balance saved in January". An operation that cannot apply to an element (arithmetic on a
   value the element does not have, or a result out of range) is skipped for
   that element and reported when the Event fires; Save refuses an operation
   that is not filled in.
2. **Pick the scope** — *Local* or *Global* (§2.6).
3. **Apply** the Event. Several can be stacked before propagating.
4. **Propagate.**
5. **Advance time** if anything is on backup: **Temporal Jump** moves the clock
   by hand, *Auto-advance* jumps to the next expiry and re-propagates until
   nothing is left holding.

**Reset** ends the scenario and hands back a working network: every element goes
to full Functionality, with no countdown and no damage, whatever put it there.
It also reverts what Events and Propagations wrote beyond Functionality — an
attribute set by a rule, for instance — ends any temporal-jump run, and clears
the Analysis Heatmap, whose colours describe a scenario that no longer exists.

Model edits are yours and survive: a renamed element, a moved node, a corrected
capacity. One consequence worth knowing: an element deliberately authored below
full Functionality as its *normal* state is raised to full as well. Reset
guarantees a working network rather than reconstructing a past one.

## 5. Testing an intervention

An intervention is a model edit, re-run and compared against a Scorecard entry
saved from the baseline. Save before, edit, propagate, save after.

| Intervention            | Set                                                              |
| ----------------------- | ---------------------------------------------------------------- |
| Physical hardening      | remove that element's `Vulnerability levels` entry                |
| Preparedness protocol   | a Specific rule                                                  |
| Load-shedding agreement | raise `Priority` on the protected consumer                        |
| New backup              | `Has backup` + `Backup duration`                                  |
| More headroom           | raise `Supply Capacity`, or the `Throughput Capacity` of the limiting node or edge |

The **Repair** panel ranks what to fix first: only directly damaged elements can
be repaired, and each is scored by the Operativity it would return along its
responsibility chains (§2.5), and again per repair hour.

## 6. Analysis results

The Analysis window scores every element. It floats over the canvas — drag its
title bar to move it, its edges to resize it, and the − button to roll it up when
you want the canvas back.

| Family                | Examples                                    | Cost                                                                 |
| --------------------- | ------------------------------------------- | -------------------------------------------------------------------- |
| **Topological** | betweenness, reachability, communities      | runs in the browser, instant                                         |
| **Model-based** | Vitality, Shapley                           | re-runs the engine once per element or coalition — needs the server  |

The panel shows the engine call count before a model-based run starts, and
Cancel keeps whatever it has computed.

**OI node weight** decides which node attribute weights the Operativity Score.
Changing it re-scores the result already computed — no new engine calls, nothing
lost — so several weightings can be tried on one expensive run.

Scores are painted onto the elements as soon as the metric finishes. The canvas
legend swaps its Functionality scale for the metric's own key, because the
colours no longer mean Functionality. The overlay stays until **Clear heatmap**
or a Reset; closing the Analysis window leaves it alone, and the Analyse button
carries a dot while a heatmap is live.

After a Shapley run, **Export Shapley values (JSON)** saves one φ̂ per element
plus the seed the run used, so the same estimate can be replayed later.

## 7. Saving and loading

The **File** button in the Topbar opens four tabs.

| Tab              | What it does                                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Local**  | Save to your computer, open a `.json` file, and the last 10 saves kept in this browser. Plus a backup folder, written to every time you close the tab. |
| **Cloud**  | Save to your account and open it on any device. Last 10 kept. Needs sign-in with Sync.                                                                |
| **Import** | Build a project from an EPANET `.inp` file.                                                                                                           |
| **New**    | Start a fresh project. The current one stays open until the setup is finished, so Cancel costs nothing.                                               |

Local and cloud saves are independent: clearing the browser does not touch the
cloud saves, and deleting a cloud save does not touch the computer.

**Auto-save** (Cloud tab) keeps one spare copy that updates as you work. It never
replaces one of the 10 cloud saves. Switching it off deletes it.

### 7.1 LLM Design

**LLM Design** in the Topbar, beside Help, shows everything the project and its configuration
save as a tree, each part as JSON you can edit by hand or with an LLM:

- **Project** — Project info, Canvases, Nodes and Edges (each grouped by the
  canvas they are on), Scorecard, Temporal Simulations.
- **Configuration** — Events, Categories, the Functionality scale, the rest.
- **Bulk operations** — changes by rule, for many elements at once: "scale
  every Source's supply by 0.5", "set importance 2 on every Service", "delete
  every node whose label contains *spare*", plus adding, updating or deleting
  Events, Categories, canvases and simulations by id. The box opens on an
  example that uses your model. The preview lists each change with what it
  matched, changed and skipped.

Any level opens: a group shows everything under it, so one edit there changes
many items; a single item shows just that one. Deleting a node in Nodes also
deletes its edges and takes it off every canvas, and deleting an Event in Events
removes its vulnerability levels; a node added under a canvas is placed on it.
The undo history is not shown and cannot be changed.

**Copy with context for an LLM** copies the open part with this model's ids and
names. Paste the reply and press **Check & preview**: every change is shown as
before → after, or every problem is listed, and **Copy the problems for the
LLM** hands them back to it to fix. In Bulk operations each change has a tick:
untick the ones you don't want. Nothing changes until you press **Apply**. The
project as it was is kept in Recent saves first, and **Undo this edit** puts it
back.

**Recipes** do a whole job for you, even if you don't know CASCADE yet. Pick one, type
or paste what it asks for, **Copy for the LLM**, and paste its reply into Bulk operations:

- **Model from a description**: describe your organisation in your own words. The
  LLM asks what it needs, then builds the model.
- **Import an organisation's data**: paste an asset list, a table or a document.
- **Red-team Events**: an LLM with no stake in your organisation proposes hazards
  across sectors (weather, outages, cyber, supply chain, staff, combinations) and
  what each one strikes.
- **Explain the current state**: what is degraded and why, in plain words. Its
  answer stays in your LLM.

The first time you copy for an LLM, the app reminds you that your model's names
leave your computer when you paste them. Use a chat that keeps no history, or an
LLM running on your machine. Tick *Don't tell me again* to stop the reminder.

What LLM Design adds is marked **unconfirmed**, with the LLM's reason, in the
Inspector and in the Events tab, where an LLM's frequency shows as an estimate.
**Confirm** it once you have checked it; the Inspector confirms a whole selection
at once.

You can also start from where you are: right-click the Canvas (**Ask an LLM about
the selected**), the robot button in the Inspector's header, **Red-team Events
with an LLM** in the Events tab, or **Explain with an LLM** in the Analysis
window. Pasting an LLM's reply onto the Canvas opens it in Bulk operations, already
checked.

## 8. Server and roles

**Propagate** and the model-based analyses (Shapley, Vitality) need the server
and `can_propagate` — `analyst` and above. **Sync** needs `can_sync`. Everything
else, including topological analysis, works offline. Roles also carry a node cap
and an engine-evaluation budget per minute.

## 9. Temporal Simulation

A Temporal Simulation runs the model over many periods: hours, days, months.
Each period applies its changes, then propagates, and quantities that persist
from one period to the next (a tank, a budget, hours owed) carry over. A project
holds as many as you like, saved with it; **Simulate** in the Action Bar opens
them. The picker at the top of the window selects the one the tabs edit and
**Run** runs, and adds (**New**), copies (**Duplicate**) or removes (**Delete**)
one; its name is its Timeline's name. A run uses the scope picked in front of
Propagate, Simulate and Analyse (one scope for the three), *global* or *local*
on the active canvas, and saves it with the Temporal Simulation.

### 9.1 The definition

- **Timeline.** A list of **Steps**. A Step is a period label, a unit (hour,
  day, week, month, quarter, year, or none) and a repeat count: `2024-01`,
  month, 12 is a year of months, labelled `2024-01` … `2024-12`. Each Step has
  **Phases**. A Phase applies its Events, then optionally propagates. An Event
  in a Phase fires every period of its Step, or every N-th. An Event meant only
  for simulations (a repair, a settlement) is marked *Temporal Simulation only*
  in Config → Events, which keeps it off the Action Bar.
- **Profile.** The grid under the Timeline: one row per value that changes over
  time (a demand, a supply), one cell per period. A row is an Attribute
  Operation (§4) with a value per period; a `set` value stays until the next
  one, shown greyed in the cells after it.
- **Metrics.** Your own read-outs, computed per period (§9.4).
- **Text.** The whole definition as JSON, to edit in bulk or hand to an LLM:
  *Copy with context for an LLM* adds a primer, the format and this project's
  elements; paste the reply back and *Check*: besides the format, Check tries
  the profile on your model and lists any operation a run would refuse (a
  field an element does not have) and any Metric nothing can answer. Then
  *Apply*. Events and the rest of the model
  change through LLM Design (§7.1).

Every change over time goes in before a run, as a profile value or a Phase
Event. Each edit is saved into the project once it is complete; until then, the
line under the window's title says what is missing, and the project keeps the
last complete definition.

### 9.2 Stocks

A **Stock** is a capacity with a level that persists across periods. In the
Inspector's **Capacities**, the database icon beside a supply (or under an
edge's capacity) turns the number into a Stock:

| Field            | Means                                                                 |
| ---------------- | --------------------------------------------------------------------- |
| Rate per period  | what the plain number carried                                         |
| Level            | what is on hand; positive = available to draw, negative = owed         |
| Min / Max        | the bounds of the level; Min defaults to 0, Max to none                |
| Max draw         | the most the level may add to supply in one period                    |
| Inflow           | credited each period; defaults to the rate                            |
| Retention / Efficiency | multipliers on the level and on the inflow (decay, interest, loss) |

A Stock supplies its rate plus what its level can give above Min. After each
period's last propagating Phase its level moves once: **level + inflow −
delivered**, kept between Min and Max; what the bounds cut off is reported. A
damaged Stock credits a share of its inflow, the share its Functionality
carries (§2.2).

**Storage** (the toggle, nodes only) is a tank: it takes water from its own
Category's network and feeds it back. Other sources serve the consumers first
and the tank covers only what they cannot; it fills last, from what is left
after every consumer, up to Max fill. Tanks reaching the same zone draw and fill
by the same fraction of what each offers.

A node Stock with a rate integrates only while it is its Category's one source;
an edge Stock only while its target has one incoming edge of that Category.
Otherwise the run skips it and says so. Undeclared edge and throughput
capacities in a Category with a Stock default to its largest supply, draw
included; the Inspector asks you to declare them.

### 9.3 Running

**Run** needs an account allowed to Propagate. It copies the model, resets the
copy (§4) and runs every period in order, one Propagation, with the shared
scope (§2.6), for each propagating Phase; each counts as one Engine
Evaluation. One run at a time: to run another Temporal Simulation, end this
run first. A progress bar shows how far it is; **Cancel**, a refused request or
an engine error keeps nothing and names the period it stopped in.

Between periods, every element's Functionality returns to what Events left it
at, and each Propagation recomputes shortage from that period's supply. So a
consumer recovers when its supply comes back, while damage an Event caused
stands until another Event repairs it. Nothing counts down repair times or
backups on its own: a repair is an Event in its period, and time passes only
where a Phase lets hours pass (the clock field in its row).

When the run ends, the **Run View** shows it. Pick a period in the Run tab, or
step through them in the strip under the Action Bar: the canvas and the
Inspector show that period's end. Your model and your Temporal Simulations are
read-only while a run is shown; using a blocked control makes **End run** pulse.
**End run** or **Reset** returns the model exactly as it was. The run itself is not
saved.

### 9.4 Reading a run

The **Run table** has a row per period: the Operativity Score, the coverage of
each flow Category (delivered ÷ demand), each Category's total stock level, then
your Metrics. Untick a standard one at the top of the Metrics tab to hide it. A Metric selects elements with a filter (§4), reads a field (its
value at the period's end, or its change over the period or one Phase) and
aggregates it: sum, mean, min, max, count, a percentile, or the share of values
passing a comparison. A Metric no selected element can answer shows "—".
**Export CSV** saves the table.

Above the table, **Results** has a card per column: its value at the selected
period, its minimum, mean and maximum across the run, and a line of the whole
run. Click a line to select the period under the pointer.

**Compare** (a tab of the Simulate window) weighs several Temporal Simulations
against each other: tick them and press Compare. Each runs in turn as Run does,
on its own Reset copy of the model, without opening the Run View. The table
then has a row per Temporal Simulation and a column per Metric, matched by
name, showing the run's End, Mean, Min, Max or Total (the sum over periods, for
a per-period flow). Click a Metric's name to chart it over time, one line per
Temporal Simulation. **Export CSV** writes all five statistics. The comparison
is kept for the session; editing a Temporal Simulation marks it out of date.

**Level Mode** (Canvas colours → Level) recolours each Stock by its level, or
its change over the period, divided by its reference: its own *level reference*
or *change reference*, else max(|Min|, |Max|). The bands are the **Level
Scale**, under Config → Functionality Scale; elements without a Stock turn light
grey.

**Save to Scorecard** keeps the ticked periods of the Run table (all of them
unless you untick some) together, as one entry: per period its end state, the
table's values and its Stocks, with each Metric's minimum and mean across the
run. On the Scorecard, a slider steps through the saved periods and the network
switches between Functionality, Stock level, Stock change and Stock average.
When the entry holds Stocks and more than one period, it also lists each
Stock's average level over the saved periods, divided by its reference, with
the colour and name of its Level Scale band. The run's start is stored once
and each period only what changed since it.

### 9.5 Importing an aqueduct

The EPANET import (File → Import EPANET .inp, *Replace project*) has a
**For a Temporal Simulation** option. Each tank then becomes storage, sized from
its geometry and its pipes, and the project gets a starting simulation from the
file: hourly periods over its duration, each consumer's demand pattern as
profile values, and each timed control as an Event in its hour. Controls that
depend on a tank's level are listed as skipped: a full tank already stops
taking water.

Two samples show the whole feature: **Net1 — an aqueduct over a day** (a pump
outage, a repair and an evening surge drain and refill the tank) and the **IJDRR
example**, whose Timeline is a year with two earthquakes and a repair.

## 10. Keyboard shortcuts

Every shortcut the editor listens for. They are ignored while you are typing in a
text field, so they never fight the Inspector. `Ctrl` is `⌘` on macOS.

### Editing

| Key                            | Does                                                                |
| ------------------------------ | ------------------------------------------------------------------- |
| `Ctrl+Z`                     | Undo the last change to the network.                                |
| `Ctrl+Y` or `Ctrl+Shift+Z` | Redo.                                                               |
| `Ctrl+A`                     | Select every element on the current Canvas, and open the Inspector. |
| `Ctrl+C` / `Ctrl+V`        | Copy the selection, and paste it onto the active Canvas.            |
| `Delete` or `Backspace`    | Delete the selected nodes and edges.                                |

### Scenario

| Key        | Does                                                                                                                                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Ctrl+R` | Clear the most recently applied Event, and the cascade computed from it — a Propagation whose Event is gone describes nothing. Other Events stay applied but un-propagated; re-run Propagation for the new cascade. Your own edits are untouched, and `Ctrl+Z` brings the Event and its cascade back. It takes over the browser's reload shortcut while the canvas has focus; use `F5` to reload. |

### View and tools

Single letters, no modifier.

| Key   | Does                                        |
| ----- | ------------------------------------------- |
| `V` | Select tool                                 |
| `N` | Add node                                    |
| `E` | Add edge                                    |
| `H` | Pan (drag the canvas)                       |
| `F` | Fit the whole network on screen             |
