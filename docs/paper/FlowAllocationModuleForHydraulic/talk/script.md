# Talk script: Composable Disservice Propagation (CNA 2026)

Twelve minutes, eleven slides. Every claim and number below is in the paper.

## How to use this script

- **The thread.** One district is still connected to its reservoir and still has no
  water. It opens the talk, returns with the results, and closes it.
- **The refrain.** *Some dependencies ask **whether**. Others ask **how much**.* Say it
  word for word every time it appears; it is the one idea a half-listening audience
  should leave with.
- **Bold lines** are the anchors: learn them exactly. Everything else can be said in
  your own words, as long as the numbers stay exact.
- *(skip if late)* marks a sentence you can drop without breaking the story.
- [Brackets] are stage directions. Pause where marked; a pause is where a distracted
  listener catches up.

---

## 1 · Title (0:30 · total 0:30)

*Hook: connected district, no water.*

Good morning. I am Cristian Curaba, from the University of Udine, and this is joint work
with Stefano Grimaz.

I want to start with a question that sounds trivial. **A district is still connected to
its reservoir. Is it getting water?**

Topology says yes. The physics often says no. [pause] This talk is about that gap, and
about a light way to close it.

## 2 · Two extremes (1:05 · total 1:35)

*Hook: simulators, topology, the district.*

When we model failures that cascade across infrastructure, we usually choose between two kinds of tool.

The first kind is the domain simulator. Simulators are
physically faithful. They also need calibration for every domain, and its hard to connect to other simulations or analysis.

The second kind is topological abstraction, such as centrality metrics. Topological models
are general, need little data, and gave this community deep results on cascading collapse.
They see connections only: supply and quantitative capacities stay invisible.

And that brings back our district. Connected to its reservoir, still it may be without water.
**Topology alone cannot always tell whether service is delivered.**

## 3 · Whether, and how much (1:05 · total 2:40)

*Hook: pump = whether (OR, AND); districts = how much.*

The key idea of this talk fits in one sentence. **Some dependencies ask whether. Others
ask how much.**

Take a pumping station. It needs electricity, from the grid OR from a generator: one is
enough. It also needs telemetry, so electricity AND telemetry must both be there. That is
a question of *whether*, and Boolean gates answer it.

Now take the districts that station feeds. They share a finite supply through pipes of
finite capacity. When supply is below total demand, every district gets a share, and the
district behind the narrow pipe gets less. That is a question of *how much*.

[pause] Whether, and how much.

## 4 · The architecture (1:25 · total 4:05)

*Hook: attributes choose the algorithm; best-of, worst-of; plug-in; repeat.*

So how do we put both questions into one model?

We start from an ordinary directed network. Services are represented as nodes. The oriented edges represent depedencies. Every node carries a  functionality status: operational, warning or critical.

Each node also carries a few attributes, such as the service it provides. Based on these attributes, we send each dependency to the right algorithm: **does this dependency ask
whether, or how much?**

If it asks *whether*, it goes to the logical propagation, and the rule is boolean.

If it asks *how much*, it goes to a plug-in that computes quantities. For water, that is our flow module.

Then the two answers meet. A node takes the worse of the two. Extra guards can soften or delay a drop, and the commit holds or drops the functionality status. Then we repeat.

**The contribution is the coupling: whether and how much are integrated in one mechanism that decides how disservice propagates updating the functionality status of nodes.**

## 5 · Convergence (1:00 · total 5:05)

*Hook: same language; only down; finite steps.*

A fair question from this audience: if two mechanisms feed each other in a loop, does the
loop ever stop?

It does, and the reason is simple. Both mechanisms speak the same language:
operational, warning, critical. And **a status can only stay or get worse. It never
recovers within a run.**

A finite number of elements, each with a finite number of steps down: the iteration has
to stop. At most twice the number of nodes plus edges, plus one rounds, and in
practice much sooner. *(skip if late)*

[pause] That gives us termination.

## 6 · The flow module (1:10 · total 6:15)

*Hook: pipes with a maximum, fair shares, ratio to status, no pressure.*

Let me open the flow module box for water.

Picture the network as pipes, each with a maximum flow. Sources push water in:
reservoirs without limit, tanks at a limited rate. Each junction asks for its demand.

The ratio of served to demanded water becomes the functionality status: more than two
thirds, operational; between one and two thirds, warning; a third or less, critical.

Everything is built automatically from the EPANET file. Pipe capacity comes from one
standard design velocity, two and a half metres per second. In the validation we set no
priorities, so everyone shares a shortage equally. *(skip if late)*

I want to be clear about what this is. **It is a light-data approximation: it knows
capacity, supply and demands without computing pressure.**

[pause] Whether that answer is *right* is a separate question, and for that we compare
against physics.

## 7 · The test (1:05 · total 7:20)

*Hook: same break twice; same ratio-to-status logic; reachability; eight, four, 939.*

So: **does the flow module find hydraulic disservice well enough to be useful?**

We took eight water networks: the three classic WNTR examples, three real Italian
aqueducts, Modena and C-Town.

On each one we break things, and we apply the same break twice: once to a
pressure-driven WNTR solve, which is our ground truth, and once to our flow module, built
automatically from the same file.

We break things in four ways: local clusters of pipe breaks, attacks on the biggest mains
and pumps, source failures, and tank losses. That gives nine hundred and thirty-nine
situations.

On both sides, disservice is computed junction by junction with the same logic: the ratio
of served to demanded water becomes the functionality status, operational, warning or
critical.

And we compare with the standard topological answer, reachability: a junction is
critical only when it is cut off from every source.

The question for every junction is: **did you find the ones WNTR calls critical?**

## 8 · The results (1:30 · total 8:50)

*Hook: recall; almost half against one in ten.*

Here is the answer.

We measure recall: of the junctions WNTR calls critical, how many do you find?

On local clusters and tank losses, both methods do well.

[point to the targeted row] Now look at the attacks on the big mains. **Reachability
misses 46 percent of the critical junctions, almost half. The flow module misses 10
percent, one in ten.**

Source failures tell the same story: 46 percent missed against 8 percent, on a smaller
set of 24 situations.

[pause] And every junction reachability misses is our district from the beginning: still
connected to a source, still without water. **That is where *how much* changes the
answer.**

## 9 · The price (1:10 · total 10:00)

*Hook: Net3, ten, seven, eleven; cautious; screening.*

Now the price. Here is one situation on Net3, with three large mains closed.

[point left to right] On the left, WNTR: ten critical junctions, in red. On the right,
reachability: nothing, because nothing is disconnected. In the middle, our module finds
seven of the ten, and it raises eleven false alarms.

That is the pattern across the board. In every family, the module finds between 90 and
98 percent of the critical junctions. About three in four of its alarms are real: precision
is 73 percent on average, lowest for source and tank failures. **The module is cautious: it
over-warns.**

We tried the obvious fixes on capacity, and none of them removed the false alarms.
*(skip if late)*

So here is the honest reading. **The module is good for screening:** it finds the
junctions at risk and flags some extra. For exact hydraulics, you still run the simulator.

## 10 · Shown, and open (1:10 · total 11:10)

*Hook: three shown; three limitations: time, overload, other domains.*

Let me be precise about what we have shown.

Shown by validation: the flow module approximates WNTR under the failures we tested.
Shown by construction: the logical and flow algorithms are integrated, because both
output the same thing, the functionality status of each node. And the intended use: places where a simulator or physical data is missing, or hard to connect to other systems.

Three limitations remain. There is no time axis, so no repair and no recovery. There is
no overload cascade: a pipe at capacity simply carries no more. And power, transport and
telecommunications each need their own plug-in and their own validation.

## 11 · Close (0:50 · total 12:00)

*Hook: the district again; the refrain; open code; questions.*

To close, back to our district: connected, and still without water.

**Some dependencies ask whether. Others ask how much.** A composable disservice propagation model can preserve the generality of topological abstractions while adding quantity awareness exactly where service delivery requires it.

Everything is open: the code, the data and the results. The QR code takes you to the
platform.

Thank you. I am happy to take questions, especially on the assumptions, the validation,
and other domains.
