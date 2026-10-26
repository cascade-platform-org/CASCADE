"""
framkit/model.py — a FRAM model as the papers describe it, before any translation.

A FRAM model is a set of functions and a set of couplings. A coupling joins the
Output of an upstream function to one aspect (I, P, R, C, T) of a downstream
function, and it is identified by the output's text: two functions that produce
the same text produce the same output (FMV couples by name match). External
resources and conditions that no function produces (Zheng 2024's
"Radio/Telephone") are kept as background functions, so the physical hooks of a
model have a node to attach to.

FMI profiles (Hill & Slater 2024) say how a function combines the couplings of
one aspect type: All (every coupled aspect must be present), Any (one suffices)
or None (the aspect type is ignored). The default is All.
"""
from __future__ import annotations

from dataclasses import dataclass, field

ASPECTS = ("I", "P", "R", "C", "T")
PROFILES = ("All", "Any", "None")


@dataclass(frozen=True)
class Coupling:
    source: str     # upstream function id
    output: str     # the output's text; same text = same output
    target: str     # downstream function id
    aspect: str     # one of ASPECTS


@dataclass
class Function:
    id: str
    name: str
    background: bool = False
    # aspect -> profile; a missing aspect means "All"
    profiles: dict[str, str] = field(default_factory=dict)

    def profile(self, aspect: str) -> str:
        return self.profiles.get(aspect, "All")


@dataclass
class FramModel:
    name: str
    functions: dict[str, Function] = field(default_factory=dict)
    couplings: list[Coupling] = field(default_factory=list)

    def add_function(self, fid: str, name: str, background: bool = False) -> Function:
        if fid not in self.functions:
            self.functions[fid] = Function(fid, name, background)
        return self.functions[fid]

    def add_coupling(self, source: str, output: str, target: str, aspect: str) -> None:
        if aspect not in ASPECTS:
            raise ValueError(f"unknown aspect {aspect!r} on {source}->{target}")
        c = Coupling(source, output, target, aspect)
        if c not in self.couplings:
            self.couplings.append(c)

    def incoming(self, fid: str) -> list[Coupling]:
        return [c for c in self.couplings if c.target == fid]

    def outputs(self) -> dict[tuple[str, str], list[Coupling]]:
        """(source, output text) -> the couplings that carry it."""
        out: dict[tuple[str, str], list[Coupling]] = {}
        for c in self.couplings:
            out.setdefault((c.source, c.output), []).append(c)
        return out

    def is_acyclic(self) -> bool:
        import networkx as nx
        g = nx.DiGraph((c.source, c.target) for c in self.couplings)
        return nx.is_directed_acyclic_graph(g)

    def summary(self) -> str:
        by_aspect = {a: sum(c.aspect == a for c in self.couplings) for a in ASPECTS}
        n_bg = sum(f.background for f in self.functions.values())
        return (f"{self.name}: {len(self.functions)} functions ({n_bg} background), "
                f"{len(self.couplings)} couplings {by_aspect}")
