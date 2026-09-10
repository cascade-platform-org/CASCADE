# CASCADE — User Manual

> Also in the app: the **Help** button in the Topbar opens the same text as a
> side panel, with a **guided tour** that walks the core loop on a worked
> example. Kept in sync with `CASCADE-app/components/help/user-manual.tsx`.

1. [Setting up an element](#1-setting-up-an-element) ·
2. [Rules](#2-rules) ·
3. [Running a scenario](#3-running-a-scenario) ·
4. [Testing an intervention](#4-testing-an-intervention) ·
5. [Server and roles](#5-server-and-roles) ·
6. [Keyboard shortcuts](#6-keyboard-shortcuts)

---

## 1. Setting up an element

Select a node or edge and fill in the Inspector on the right.

### Identity and type

| Field | Meaning | Consequence |
|---|---|---|
| **Label** | The name shown on the canvas. | Rules can reference it. Two nodes with the same label make any rule naming it ambiguous — the rule is reported, not guessed. |
| **Node Type** | Source / Infrastructure / Service / Personnel. | Changes the shape drawn, nothing else. It does **not** make a node supply or consume anything — `Supply Capacity` and `Demand` do that. |
| **Categories** | The services this node deals in (`water`, `power`, `transport`, `manager`, …). | Determines how neighbours aggregate it: suppliers of the same category are alternatives, different categories are all required. A node with no category participates in nothing. |

### Supplier or consumer

Per category a node should be one or the other.

| Field | Meaning | Consequence |
|---|---|---|
| **Supply Capacity** `{category: amount}` | Makes the node a source of that category. | Effective output is `supply_capacity × functionality / N`, so a source at `operational_warning` on a 3-level scale delivers two thirds. Leave it empty and the node supplies nothing, whatever its Node Type says. |
| **Demand** (per category, in the profile) | Makes the node a consumer of that category. | Only nodes with `demand > 0` are served by the flow allocation. A `SourceToDemands` node with no demand is invisible to it. |

Setting both for the **same** category is accepted but almost always a slip: the
node becomes a source *and* a consumer of that category and partly serves its own
demand. The Inspector flags it — split the node in two, or clear one value.

### Category Dependency Profile

One block per category the node consumes. Add it, and these apply:

| Field | Meaning | Consequence |
|---|---|---|
| **Dependency level** `1..N` | How hard a shortfall in this category pulls the node down. | `N` (the default) passes the drop through unchanged. `1` means this category can never degrade the node. Values in between soften it — a `critical` upstream becomes a warning rather than a failure. |
| **Has backup** + **Backup duration (hours)** | The node holds its current level instead of dropping, and starts a countdown. | The drop is deferred, not cancelled. The countdown only moves when you fire a **Temporal Jump** — without one the node looks like it survived. On expiry it goes straight to `1`. |
| **Priority** `1..10` (default 5) | Who gets served first when supply is short. | Only used by `SourceToDemands` categories. Equal priorities share the shortage; a higher priority takes its full demand before lower ones get anything. |

A category with no profile behaves as `dependency_level = N` — full dependency.
Leaving it out never stops propagation.

### Vulnerability levels

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

### Socio-economic values

| Field | Meaning | Consequence |
|---|---|---|
| **Importance** `0–1` | How much this node counts. | No effect on propagation. It weights the Operativity Score, and through it decides which elements the Shapley analysis calls neuralgic. |
| **Cost of disservice / day** | Money lost per day while degraded. | Same: scoring and the repair ranking, never the cascade itself. Takes precedence over Importance where both are set. |

### Edges

An edge `a → b` means **a supplies b**. Drawn the other way, nothing propagates.

| Field | Meaning | Consequence |
|---|---|---|
| **Capacity** | Ceiling on the flow the edge carries. | Scales with the edge's own Functionality. An edge carries exactly one category — for two limits on the same connection, draw two edges. |
| **Functionality** | The edge's own condition. | The engine commits `worst_of(edge, source node)`, so an intact edge from a failed source is still down. |
| **Vulnerability levels** | Same as nodes. | An edge can be broken directly by a Hazard — a cut cable, a collapsed bridge. |

## 2. Rules

Rules cover what the graph alone cannot express. The grammar reference is the
**Rules Manual** panel in the app; this is about when and why.

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

**Reset** returns every element to `N` and ends the current Situation.

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

The Analysis page scores every element. **Topological** metrics (betweenness,
reachability, communities, …) run in the browser. **Model-based** metrics
(Vitality, Shapley) re-run the propagation engine once per element or coalition,
so they need the server and can take a while — the panel shows the call count
before you start, and Cancel keeps whatever it has.

**Apply heatmap & minimize** paints the scores onto the elements and closes the
Analysis page so you can see them. The canvas legend swaps its Functionality
scale for the metric's own key, because the colours no longer mean Functionality.
The overlay stays until you press the X in the Analysis page.

After a Shapley run, **Export Shapley values (JSON)** saves the result: one φ̂ per
element, plus the seed the run used. Keeping the seed means the same estimate can
be replayed later, and the file is what the paper's centrality comparison reads,
so a published number is always a number the app produced.

## 6. Server and roles

**Propagate** and the model-based analyses (Shapley, Vitality) need the server
and `can_propagate` — `analyst` and above. **Sync** needs `can_sync`. Everything
else, including topological analysis, works offline. Roles also carry a node cap
and an engine-evaluation budget per minute.

## 7. Keyboard shortcuts

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
| `Ctrl+R` | Clear the most recently applied Event, putting back exactly the fields it changed. A Propagation you ran after it stays — this undoes the Event, not the cascade. Note this takes over the browser's reload shortcut while the canvas has focus; use `F5` to reload. |

### Tools

Single letters, no modifier — they pick the active tool, the same as clicking it
in the toolbar.

| Key | Tool |
|---|---|
| `V` | Select |
| `N` | Add node |
| `E` | Add edge |
| `H` | Pan |
