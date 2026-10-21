# ADR-0024 — An agent in the modelling loop: tools in the tab, Proposals, the Agent Bridge

**Status:** accepted (2026-10-21, release v1.2). Built: `lib/agent-tools.ts` (the tools),
`lib/agent-host.ts` (the live tab), `store/agent-store.ts`, the Topbar's **Agent** window
(`components/agent/`), `lib/agent-kit.ts` (the Agent Kit), `lib/agent-bridge.ts` (the tab's
socket), `public/agent/cascade-mcp.mjs` (the agent's MCP server), and on the backend
`api/agent_routes.py`, `services/agent_bridge.py`, `db/agent_tokens.py`, migration 008.

## Context

CASCADE is expressive, and each of its concepts has to be learned before it is useful. The
pilot programme sells a half-day mapping session to SME directors, who think in policies and
numbers and will never edit a `dependency_level`. LLM Design (ADR-0022) already lets an LLM
write a model, but through copy and paste: the LLM cannot run what it wrote, cannot see that
the model contradicts what the person said, and cannot iterate, and the person carries the
text back and forth. Release v1.2 puts an agent in the loop: it interviews the person, writes
Expectations (ADR-0023), models, runs, calibrates and explains. The person decides what
becomes part of the model.

The first users are a facilitator and a director in the same room. Self-service follows.
Where the LLM runs (a local model, a VM, a hosted agent) is left to the person.

## Decision

**Ownership.** The organisation owns the model; the facilitator operates the app; the agent
owns nothing. It reads, runs on copies, and **proposes**: a person applies, the organisation
confirms (Provenance, now with `origin: "agent"`).

**Tools run in the tab** (`lib/agent-tools.ts`). Each tool is a typed entry (Zod parameters,
sent as JSON Schema) wrapping what the app already does: `describe_model`, `get_reference`
(the same guides the Recipes copy), `get_elements`, `propose_change`, `get_proposal`,
`run_scenario`, `run_expectations`, `run_simulation`, `analyse` (topological, free),
`explain_state`, `show` (selects Elements so the person sees what the agent means). A tool
reaches the app only through an `AgentHost`. `lib/agent-host.ts` is the live one, and tests
use a bundle and a fake engine. Running in the tab means the engine calls are the tab's own,
with the person's session, Entitlement and scope rules, and the engine boundary (CLAUDE.md
§7) is untouched. No backend endpoint gives an agent anything the person's own tab could not
already do.

**Proposals are the only write path.** `propose_change` takes plain changes (ADR-0022 v2),
checks them now (a refused change returns the repair context, as "Copy the problems for the
LLM" does), and records a pending Proposal. The Agent window shows it with LLM Design's
preview and a tick per change. Apply re-checks against the model as it is then and writes
through `applyModelBundle`, as one undo step with a version kept first. Reject can carry a
reason the agent reads with `get_proposal`. Every tool call is logged in the window for the
session.

**The Agent Kit** (`lib/agent-kit.ts`, Agent → Agent Kit) is the downloadable context:
`AGENTS.md` (ownership, the interview, Expectations first, small Proposals, calibrating by
changing what the system *is*, plain-language answers), the references, this project's
context, `SETUP.md`, `cascade-mcp.mjs` and `tools.json`. Every text in it is built from the
strings the Recipes and tools already use. Without the bridge the same kit serves the
copy/paste route.

**The Agent Bridge** connects an agent that runs outside the browser to the open tab:

```
agent ─MCP stdio─ cascade-mcp.mjs ─WS + personal token─ relay ─WS + session cookie─ tab
```

- `cascade-mcp.mjs` is a dependency-free MCP server (JSON-RPC over stdio, Node ≥ 22's
  WebSocket). Shipping it without an npm dependency tree means there is no third-party code
  for the person to trust.
- **Personal tokens** (`POST/GET/DELETE /api/agent/tokens`, `can_propagate`): `cas_` + 32
  random bytes, stored as SHA-256 only, shown once, 30-day expiry, revocable, listed with
  last use, in the GDPR export and erased with the account. A token authenticates the agent
  socket and nothing else.
- **The relay** (`services/agent_bridge.py`) is a per-user switchboard: one tab per user (a
  newer one replaces the older, which is closed with code `4409`), any number of agents. Each agent waits until the person
  presses **Approve** in the tab, and every approval ends with the tab. A call with no tab,
  or before approval, is answered at once with what to do. The relay reads only routing fields
  and never stores or logs a message. State is in memory, on the single backend instance
  ADR-0008 already assumes.
- **Cross-site WebSocket hijacking** is closed by checking the tab socket's `Origin` against
  the CORS list. A browser attaches cookies to a WebSocket from any page, and this check is
  what keeps another site from opening the tab end as the user. A refused tab is closed with
  a code and the reason in words (`4401` not signed in, `4403` another origin or no
  `can_propagate`), so the tab can say why.
- Local-only mode (no OIDC) pairs with the token `local`: the deployment is single-user and
  already open.
- Error reports never carry request bodies or stack-frame locals
  (`max_request_body_size="never"`, `include_local_variables=False`), so neither a
  Propagation payload nor a bridged message can reach GlitchTip (ADR-0007).

**No untested limits.** No caps on connections, message sizes or call rates were added
beyond what the deployment already has (Caddy's 10 MB body cap does not apply to WebSocket
frames). They are added when real use shows the need.

## Consequences

- requirements §13.3b's deferred "letting an agent use the app directly" is built, through the
  open tab rather than a project file: what the agent sees is what the person sees.
- An agent's quality depends on the LLM the person chooses. The guardrails do not depend on
  it: a Proposal is checked, previewed and applied by a person, and Provenance stays
  unconfirmed until confirmed.
- `degradedText` and the Expectation results are the agent's only view of a run's outcome:
  words with causes by name, bounded at 150 Elements per list.
- Open: an in-app assistant calling a configurable OpenAI-compatible endpoint (a local or VM
  model) with the same tools; headless runs with no tab open (the same tools over a bundle and
  the personal token).
