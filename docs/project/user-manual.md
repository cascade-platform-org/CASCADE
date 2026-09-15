# CASCADE — User Manual

> Also in the app: the **Help** button in the Topbar opens the same text as a
> side panel. Kept in sync with `CASCADE-app/components/help/user-manual.tsx`.

1. [Setting up an element](#1-setting-up-an-element) ·
2. [Rules](#2-rules) ·
3. [Running a scenario](#3-running-a-scenario) ·
4. [Testing an intervention](#4-testing-an-intervention) ·
5. [Analysis results](#5-analysis-results) ·
6. [Saving and loading](#6-saving-and-loading) ·
7. [Server and roles](#7-server-and-roles) ·
8. [Keyboard shortcuts](#8-keyboard-shortcuts)

**Guided tour** — the core loop, on a worked example.
**Build a model** — build one that cascades, on a new empty canvas.
**Customize the Propagation** — change one declaration at a time, and re-propagate to read what it did.
**Analyse and decide** — causality, time, the Scorecard, the Analysis Module and repair ranking.

---

## 1. Setting up an element

Select a node or edge and fill in the Inspector — the panel on the right. The
headings below are the Inspector's own sections, in the order it shows them, and
the field names are the ones on its labels: keep the two side by side and every
row here has a control next to it.

A section missing from the panel has nothing to configure yet. **Supply
Capacity** appears once the node carries a Category (or is a Source), **Category
Dependency Profiles** once a Category reaches it, and **Canvas Membership** once
the project has a second Canvas.

### Identity

| Field | Meaning | Consequence |
|---|---|---|
| **Label** | The name shown on the canvas. | Rules can reference it. Two nodes with the same label make any rule naming it ambiguous — the rule is reported, not guessed. |
| **Node Type** | Source / Infrastructure / Service / Personnel. | Changes the shape drawn, nothing else. It does **not** make a node supply or consume anything — `Supply Capacity` and `Demand` do that. |
| **Categories** | The services this node deals in (`water`, `power`, `transport`, `manager`, …). A Category is a service, often a resource that is consumed. | Determines how neighbours aggregate it: suppliers of the same category are alternatives, different categories are all required. A node with no category participates in nothing. |

### Functionality

The element's current condition — scenario state, not model. A **Reset** clears
every field in this section.

| Field | Meaning | Consequence |
|---|---|---|
| **Functionality** `1–N` | Where the element sits on the Functionality scale, `1` worst, `N` fully operational. | Sets the colour on the canvas and scales what a source delivers. Edit it by hand to pose a what-if; a Propagation overwrites it. |
| **Functionality Time** (hours) | Hours left on a backup that is holding this element up. | Above zero the element keeps its level and pulses with an amber ring on the canvas. The countdown moves only on a **Temporal Jump**; at zero the element drops to `1`. |
| **Direct damage** (physical breakage) | The element is broken itself, not starved by a neighbour. | Set by a **Hazard**, or by hand. It draws a crack on the element and is what puts it on the repair ranking — only directly damaged elements can be repaired. |
| **Expected repair time** (hours) | How long that breakage takes to fix. Shown once damaged. | Feeds the repair ranking's value-per-hour, never the cascade. |

### Supply Capacity

One amount per Category — what this element can supply.

| Field | Meaning | Consequence |
|---|---|---|
| **Supply Capacity** `{category: amount}` | Makes the node a source of that category. | Effective output is `supply_capacity × functionality / N`, so a source at `operational_warning` on a 3-level scale delivers two thirds. Leave it empty and the node supplies nothing, whatever its Node Type says. |

What the element *requires* is not here: Demand lives in its Category Dependency
Profile, further down. Setting both for the **same** category is accepted but
almost always a slip — the node becomes a source *and* a consumer of it and
partly serves its own demand. The Inspector flags it; split the node in two, or
clear one value.

### Socioeconomic Values

| Field | Meaning | Consequence |
|---|---|---|
| **Importance** `0–1` | How much this node counts. Defaults to **0.5**. | No effect on propagation. It sets the size the node is drawn at, weights the Operativity Score, and through it decides which elements the Shapley analysis calls neuralgic. |
| **Cost of disservice / day** | Money lost per day while degraded. | Same: scoring and the repair ranking, never the cascade itself. Takes precedence over Importance where both are set. |

### Category Dependency Profiles

One block per Category reaching this element, each headed by the Category name.
A block tagged *via parent* came from an edge rather than from the node's own
Categories.

| Field | Meaning | Consequence |
|---|---|---|
| **Dependency level** `1–N` | How hard a shortfall in this category pulls the node down. | `N` (the default) passes the drop through unchanged. `1` means this category can never degrade the node. Values in between soften it — a `critical` upstream becomes a warning rather than a failure. |
| **Has backup** + **Backup duration (hours)** | The node holds its current level instead of dropping, and starts a countdown. | The drop is deferred, not cancelled: the duration is written to **Functionality Time** above, and only a **Temporal Jump** moves it. On expiry the node goes straight to `1`. |
| **Demand** | The quantity of that category the node requires. This is where a consumer is declared. | Only nodes with `demand > 0` are served by the flow allocation. A `SourceToDemands` node with no demand is invisible to it. |
| **Priority** `1–10` (default 5) | Who gets served first when supply is short. | Only used by `SourceToDemands` categories. Equal priorities share the shortage; a higher priority takes its full demand before lower ones get anything. |

A category with no profile behaves as `dependency_level = N` — full dependency.
Leaving it out never stops propagation.

### Vulnerability Levels

One entry per Event, on nodes and on edges. The level the Event imposes is
`N − vulnerability`:

| Vulnerability | At N=3 |
|---|---|
| absent or 0 | untouched by that Event |
| 1 | `operational_warning` |
| 2 | `critical` |

An Event with no vulnerability entries anywhere does nothing when applied. For a
**Hazard** every affected element is also flagged `direct_damage`, which is what
puts it on the repair list.

The section is always in the Inspector, even before any Event exists — that is
the commonest reason a Propagation changes nothing, so it says so rather than
hiding. **New event** in it opens the Model Configuration on the Events tab.

### Rules

The rules attached to this element, and **Add rule**, which opens the Active
Rules window aimed at it. What to write is §2 below.

### Properties

Free key/value attributes carried with the element — a population, an asset
code, a pressure. Numeric ones become weighting options for the Operativity
Score, and Rules can read them. The engine ignores the rest.

### Canvas Membership

Shown once the project has a second Canvas: pick a **Target canvas**, then
**Copy** (the element stays here as well) or **Move** (it leaves this Canvas,
and edges crossing the boundary become inter-canvas edges). An element is
numbered once across the whole project, so the same element shown on two
Canvases is one element.

### Edges

An edge `a → b` means **a supplies b**. Drawn the other way, nothing propagates.
The Edge Inspector shows the same sections, minus the ones that are about supply
and demand: Identity is the pair it connects, and **Capacity** stands where
Supply Capacity does on a node.

| Field | Meaning | Consequence |
|---|---|---|
| **Capacity** | Ceiling on the flow the edge carries. | Scales with the edge's own Functionality. An edge carries exactly one category — for two limits on the same connection, draw two edges. |
| **Functionality** | The edge's own condition. | The engine commits `worst_of(edge, source node)`, so an intact edge from a failed source is still down. |
| **Vulnerability Levels** | Same as nodes. | An edge can be broken directly by a Hazard — a cut cable, a collapsed bridge. |

## 2. Rules

Rules cover what the graph alone cannot express. The grammar reference is the
**Rules Manual** panel in the app; this is about when and why.

Write them in the **Active Rules** panel — the Inspector's *Add rule* opens it,
and so does the Rules counter in the status bar. It suggests names, operators
and levels as you type, and aims at whatever element is selected. The dropdown
in its header picks which canvas's rules you are looking at, starting on the
one you are on; *All canvases* shows every rule in the project. Closing it
animates back into that status-bar counter, which is where you reopen it.

### 2.1 When you need one

Without any rule the engine already assumes:

- several suppliers of the **same** category → the target takes the **best** of
  them (one healthy supplier is enough);
- several **different** categories → the target takes the **worst** across them
  (it needs all of them);
- partial tolerance is `Dependency level`, not a rule;
- a delayed failure is `Has backup`, not a rule.

Write a rule when the real system contradicts one of those. Many rules usually
means the model wants a different Category Type or an extra node instead.

### 2.2 The three kinds

| Kind | Shape | What it changes |
|---|---|---|
| **Intracategorical** | `op(a, b, …) propagates to target` | How the target combines suppliers **within one** category |
| **Intercategorical** | `op(cat1, cat2, …) propagates to target` | How the target combines its **different** categories |
| **Specific** | `if <condition> then <target> is <level>` | Forces an outcome when a named situation holds |

The kind is inferred: starting with `if` makes it Specific; otherwise naming a
**category** in the arguments makes it Intercategorical, else Intracategorical.

Operators: `worst_of`, `best_of`, `average_of`, `median_of`, `majority_of`.

### 2.3 Examples

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

The first condition reads a custom attribute you added under **Properties**; the
others read live Functionality. When either operator degrades the rule stops
firing and normal propagation takes over.

Conditions take `and` / `or` / `not`, parentheses, any attribute after a dot
(default `functionality`), and `< <= > >= = ≠`.

### 2.4 Order of application

Per node, per round: **propose → guard → commit.**

1. **Propose** — supplier logic; intra/intercategorical rules swap the combining
   operator here.
2. **Guard** — `Dependency level` softens the proposal, `Has backup` defers it.
3. **Specific rules** — highest priority; a firing rule replaces the result and
   overrides both the softening and the backup deferral.
4. **Commit** — `worst_of(current, result)`.

### 2.5 What bites people

- A rule that would **improve** an element does nothing.
- In an intracategorical rule the listed elements only **select the category** —
  the operator then governs *all* of the target's suppliers in it. Name the
  category directly to be unambiguous: `worst_of(water) propagates to tank`.
- A misspelt level label or an unknown element name makes the rule **ignored
  with a warning**, not an error. Read the warnings after a Propagation.

## 3. Running a scenario

1. **Define the Event** in Config → Events, as a **Hazard** (physical damage,
   needs repair) or a **Disservice** (no damage, clears with its cause). Then set
   `Vulnerability levels` on the exposed elements.
2. **Pick the scope.** *Local* sends only the active Canvas; *Global* sends the
   whole project. **Inter-canvas edges only participate under Global** — a
   cross-sector cascade will not show up in a local run.
3. **Apply** the Event. Several can be stacked before propagating.
4. **Propagate.**
5. **Advance time** if anything is on backup: **Temporal Jump** moves the clock
   by hand, *Auto-advance* jumps to the next expiry and re-propagates until
   nothing is left holding.

**Reset** ends the current scenario and hands back a working network. Every element goes to full functionality with no countdown and no damage, whatever put it there — so Reset always repairs the graph, even if something else has gone wrong. On top of that it undoes anything Events and Propagations changed beyond functionality, such as an attribute a rule wrote. Changes to the *model* stay: a renamed element, a moved node, a corrected capacity is your work, not the scenario's. It also ends any temporal-jump run, and clears the Analysis Heatmap, whose colours describe a scenario that no longer exists.

One consequence worth knowing: an element you deliberately authored below full functionality as its *normal* state is raised to full by Reset too. Reset guarantees a working network rather than reconstructing a past one.

## 4. Testing an intervention

An intervention is a model edit, re-run and compared against a Scorecard entry
saved from the baseline:

| Intervention | Set |
|---|---|
| Physical hardening | remove that element's `Vulnerability levels` entry |
| Preparedness protocol | a Specific rule |
| Load-shedding agreement | raise `Priority` on the protected consumer |
| New backup | `Has backup` + `Backup duration` |
| More headroom | raise `Supply Capacity`, or the `Capacity` of the limiting edge |

## 5. Analysis results

The Analysis window scores every element. It floats over the canvas — drag its
title bar to move it, its edges to resize it, and the − button to roll it up to
the title bar when you want the canvas back. **Topological** metrics (betweenness,
reachability, communities, …) run in the browser. **Model-based** metrics
(Vitality, Shapley) re-run the propagation engine once per element or coalition,
so they need the server and can take a while — the panel shows the call count
before you start, and Cancel keeps whatever it has.

**OI node weight** decides which node attribute weights the Operativity Score.
Changing it re-scores the result you already have — no new engine calls, and
nothing is lost — so it is safe to try several weightings on one expensive run.

The scores are painted onto the elements as soon as the metric finishes — no
button to press. The canvas legend swaps its Functionality scale for the
metric's own key, because the colours no longer mean Functionality. Change the
OI node weight and the colours follow the new numbers.

The overlay stays until you press **Clear heatmap** or Reset the scenario —
closing the Analysis window leaves it alone, and the Analyse button carries a
dot while a heatmap is live. **Apply heatmap to canvas** puts it back after a
Clear.

After a Shapley run, **Export Shapley values (JSON)** saves the result: one φ̂ per
element, plus the seed the run used. Keeping the seed means the same estimate can
be replayed later, and the file is what the paper's centrality comparison reads,
so a published number is always a number the app produced.

## 6. Saving and loading

The **File** button in the Topbar opens four tabs.

| Tab | What it does |
|---|---|
| **Local** | Save to your computer, open a `.json` file, and the last 10 saves kept in this browser. Plus a backup folder, written to every time you close the tab. |
| **Cloud** | Save to your account and open it on any device. Last 10 kept. Needs sign-in with Sync. |
| **Import** | Build a project from an EPANET `.inp` file. |
| **New** | Start a fresh project. Your current one stays open until you finish the setup, so Cancel costs nothing. |

Local and cloud saves are independent: clearing your browser does not touch
your cloud saves, and deleting a cloud save does not touch your computer.

**Auto-save** (Cloud tab) keeps one spare copy that updates as you work. It
never replaces one of your 10 cloud saves. Switching it off deletes it.

## 7. Server and roles

**Propagate** and the model-based analyses (Shapley, Vitality) need the server
and `can_propagate` — `analyst` and above. **Sync** needs `can_sync`. Everything
else, including topological analysis, works offline. Roles also carry a node cap
and an engine-evaluation budget per minute.

## 8. Keyboard shortcuts

Every shortcut the editor listens for. They are ignored while you are typing in a
text field, so they never fight the Inspector. `Ctrl` is `⌘` on macOS.

### Editing

| Key | Does |
|---|---|
| `Ctrl+Z` | Undo the last change to the network. |
| `Ctrl+Y` or `Ctrl+Shift+Z` | Redo. |
| `Ctrl+A` | Select every element on the current Canvas, and open the Inspector. |
| `Ctrl+C` / `Ctrl+V` | Copy the selection, and paste it onto the active Canvas. |
| `Delete` or `Backspace` | Delete the selected nodes and edges. |

### Scenario

| Key | Does |
|---|---|
| `Ctrl+R` | Clear the most recently applied Event. This removes the cascade with it — a Propagation computed from an Event that is no longer there describes nothing, so it is cleared rather than left on screen. Other Events stay applied but un-propagated; re-run Propagation when you want the new cascade. Your own edits are untouched, and `Ctrl+Z` brings the Event and its cascade back. Note this takes over the browser's reload shortcut while the canvas has focus; use `F5` to reload. |

### Tools

Single letters, no modifier — they pick the active tool, the same as clicking it
in the toolbar.

| Key | Tool |
|---|---|
| `V` | Select |
| `N` | Add node |
| `E` | Add edge |
| `H` | Pan |
