# Talk script: Series and Parallel Dependency Links (CNA 2026)

## How to use this script

- **The thread.** Two pictures of the same hospital with the same shape: electricity from
  the grid and water from the waterworks, or electricity from the grid and from a
  generator. In one the hospital stops when it loses a link; in the other it survives.
  They open the talk and carry the model and the vitality example.
- **The refrain.** *Links with the same service are alternatives. Links with different services are jointly required.*
- **The second refrain** for the results: *Same graph. Only the labels change.*
- **Bold lines** are the anchors: learn them exactly. Everything else can be said in
  your own words, as long as the numbers stay exact.
- [Brackets] are stage directions. Pause where marked; a pause is where a distracted
  listener catches up.

---

## 1 · Title (0:40 · total 0:40)

*Hook: two pictures, same shape, different fate.*

Good morning. I am Cristian Curaba, from the University of Udine, and this is joint work
with Stefano Grimaz.

Let me start with two pictures of the same hospital, each with two links coming in.
**Same shape. Yet in one picture the hospital stops when it loses a link, and in the
other it survives.**

[pause] This talk is about how much it matters when we rank the important
nodes of an interdependent network.

## 2 · The two pictures (1:05 · total 1:45)

*Hook: electricity and water; grid and generator; the sentence.*

Here are the two pictures. [point left] Here the hospital gets electricity from the grid
and water from the waterworks. Two different services. Lose either, and it stops: series.

[point right] Here it gets electricity from the grid and from a standby generator. Same
service, twice. Lose one, and there is still electricity: parallel.

Identical graph topology. Any index computed from the graph topology
sees two identical pictures. What tells them apart is the service each link carries.

[pause] Therefore a qualitative data input we suggest for discerning parallel and series systems is the "service" each node provides. **Links with the same service
are alternatives. Links with different services are jointly required.**

## 3 · Two readings (1:05 · total 2:50)

*Hook: series, parallel, one reading for every link.*

The literature on networks of networks knows both behaviours. A dependency link says: if
my supplier fails, I fail, and these links are read in two ways.

The first reading: failure travels along every link. In
reliability terms this is a **series** system: lose any part, lose the whole.

The second reading: one working supplier is enough. This is a
**parallel** system: you survive as long as one part survives.

Both readings are useful. However, models and indices usually assume one and apply it to every link.

Real systems mix the two, as our hospital shows. **The service each link carries decides
which reading it gets.**

## 4 · The model (1:20 · total 4:10)

*Hook: one label; requirements from the links; OR within, AND across.*

Turning the observation into a model takes very little.

Each node gets one label: the service it provides, such as electricity or water.

From the labels, a node's requirements are read directly off its incoming links. If a
water supplier points at you, you require water. Your suppliers then fall into groups,
one group per service.

Failure spreads by one rule. **Within a group, OR: one working supplier is enough.
Across groups, AND: you need every service.** Links with the same service are alternatives. Links with different services are jointly required.

On the right, the gates for our hospital: electricity from the grid OR the generator, AND
water from the waterworks.

That is the whole model: one label per node, one line of logic. The rule only switches
nodes off, never back on, so it settles in at most as many rounds as there are nodes.
*(skip if late)*

## 5 · Vitality (1:15 · total 5:25)

*Hook: take it away; others remember; removing = switching off.*

Now, which nodes matter most?

We use a classic idea: vitality. **Take a node away, and measure what the network
loses.** Here, what it loses is operating nodes. c-v is the share of nodes that go down
when v goes, v included. Averaged over all nodes, we call it the Mean Operativity Loss, omega.

One detail makes this work: when a node leaves, the others remember what they needed. If the grid was the hospital's only electricity supplier, the hospital still needs electricity, finds none, and fails. If the hospital could forget that need, nothing would ever fail, and every node would get the same minimal score.

We also prove that, within the right interpretation of the model, taking v out gives exactly the same result as switching v off. **So the vitality of a node is what the model reports when that single node fails.**

## 6 · The experiment (1:05 · total 6:30)

*Hook: freeze the graph; change L; five classic indices.*

Now the experiment. We want to know how much the qualitative labels alone matter, so **we freeze the graph topology.**

We draw one random acyclic graph: sixty nodes, about a hundred and nine links, and we keep it fixed. The only thing we change is L, the number of different services.

With one service, all the suppliers of a node provide the same thing, so every node is
parallel. With more services, suppliers start to differ, and the network moves toward
series.

We run twenty repetitions and compare our vitality ranking with five classic indices:
reachability, PageRank, in-degree, out-degree and betweenness.

## 7 · Fivefold (1:10 · total 7:40)

*Hook: 0.023, 0.114, five times; topology stays still.*

Here is what the labels alone do.

With one service, a single failure takes down on average about two percent of the
network: omega is about two percent.

With eight services, omega is more than eleven percent.

[pause] **Same graph. Only the labels change. Five times the loss.**

And every topology index stays exactly where it was. These indices never read the labels, so this difference is invisible to them.

Why does it happen? The labels decide which links are single points of failure. A link
is one when its supplier is the only provider of that service. Links with the same service
are alternatives. Links with different services are jointly required. More services means more single
points of failure.

## 8 · The nodes worth protecting (1:35 · total 9:15)

*Hook: three in five; the paper's figure; every line moves.*

The ranking moves as well, and this is what matters for protection.

Take the same graph with one service and with eight, and look at the top ten percent: the six nodes you would protect first. **Relabelling replaces three in every five of them.**

[point to the figure] This figure, from the paper, shows the same effect from the side of the classic indices. Each line is one index, and its height is how well that index
agrees with vitality. The graph never changes, yet every line moves as the number of
services grows.

**How well a topology index ranks node importance depends on labels it never reads.**

So a protection plan built on the ranking of nodes via topology analysis alone can protect the wrong nodes.

## 9 · Where it applies, and its core limitation (1:45 · total 11:00)

*Hook: pumping station, district, sociotechnical; any initial state; the ring that holds itself up.*

This model can be effectively applied wherever you have heterogeneous services, dependency links and a notion of failure. Take interconnected services: a pumping station needs power AND telemetry, and a district
fed by two reservoirs survives the loss of either.

The same holds for sociotechnical systems, where people and software are services too: a
team needs its staff AND its software, and either on-call operator will do. *(skip if late)*

Beyond vitality, the propagation runs from any initial state: fail several nodes
together and explore different scenarios. Vitality is just the single-node case.

The core limitation is that support and failure propagation are local. [point to the ring] Here a reservoir feeds a
junction, and that junction feeds a ring of three junctions, each passing water to the
next. The reservoir fails, and the junction right after it fails too. Junction one still has a working water supplier: junction three. Junction three is
fed by junction two, and junction two by junction one. **Every junction sees a working
supplier, so the ring holds itself up**, while no water enters it anymore. The model
says operational; in reality the ring is dry.

The rule checks that a supplier exists, and never where the service comes from.
**Tracing a service back to its source needs quantities carried along the links:
a flow-based propagation.**

## 10 · Close (1:00 · total 12:00)

*Hook: write down what each node provides.*

**Links with the same service are alternatives. Links with different services are jointly required.**

So our message is simple. **When you describe an interdependent network of networks,
write down what each node provides.** On one fixed graph, that label
alone moves the average loss fivefold, and replaces three in five of the nodes you would
protect.

The code and the generators are open, and the QR code takes you to the platform.

Thank you. I am happy to take your questions.
