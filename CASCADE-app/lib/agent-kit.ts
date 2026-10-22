/**
 * agent-kit.ts — the Agent Kit: what an agent needs to model with a person in
 * CASCADE, as files (ADR-0024). Pure.
 *
 * The person downloads it from the Agent window and gives it to whatever agent
 * they use (Claude Code, Claude Desktop, opencode with a local model, an agent
 * on a VM): `AGENTS.md` (who owns the model, how to interview, how to calibrate,
 * how to answer), the references the tools also serve, this project's context,
 * and `cascade-mcp.mjs`, the small program that connects the agent to the open
 * tab through the Agent Bridge. Without the bridge the same files still work
 * for the copy/paste route: the agent writes plain changes and the person
 * pastes them into LLM Design.
 *
 * Every text here is the one the tools serve (`get_reference`'s topics,
 * `describe_model`), so the kit cannot drift from the tools.
 */

import { AGENT_TOOLS, REFERENCE_TOPICS, modelContext, toolList } from "@/lib/agent-tools";
import { FUNCTION_QUESTIONS } from "@/lib/llm-recipes";
import type { ProjectBundle } from "@/lib/schemas/bundle";

/** Where the kit's program finds the app; the relay's address is derived from it. */
export interface KitTarget {
  /** The API origin the tab talks to, e.g. https://cascade-platform.org. */
  apiOrigin: string;
}

const AGENTS_MD = `# Working with CASCADE

You help a person build and use a CASCADE model of their organisation: how a failure in one part
spreads to the rest, and what would make it more resilient. Usually two people are with you: a
**facilitator** who knows CASCADE and operates it, and a **decision maker** (a director, an operations
lead) who knows the organisation and does not know CASCADE.

## Who owns what

- **The organisation owns the model.** You never change it. Every change you want is a Proposal
  (\`propose_change\`) that a person reviews, applies in part or in whole, or rejects in the app's
  Agent window. Check the outcome with \`get_proposal\` before building on it.
- **The person confirms what is true.** Everything you add is marked unconfirmed, with your reason,
  until they confirm it. Never present an unconfirmed assumption as a fact.
- **You may read and run freely:** \`describe_model\`, \`get_elements\`, \`run_scenario\`,
  \`run_expectations\`, \`run_simulation\`, \`analyse\`, \`explain_state\` read the model or run on a
  copy of it; the model does not change. Each Propagation spends one Engine Evaluation of the
  person's quota, so do not loop blindly.

## How a session goes

1. **Look first.** \`describe_model\`, then \`run_expectations\` if there are any.
2. **Interview.** Ask the decision maker short questions in plain words, one or two at a time:
   what the organisation delivers, what each part needs to work, what has gone wrong before,
   how long things last without power, water, staff, a supplier. Repeat back what you understood.

   ${FUNCTION_QUESTIONS.replace(/\n/g, "\n   ")}
3. **Write what they know as Expectations before modelling it.** Each fact they state about how
   the system behaves ("if the grid fails, the hospital runs 8 hours on its generators, then
   stops") becomes an Expectation in their words (\`{ "add": "expectation" }\`, see
   \`get_reference\` "expectations"). Ask them to confirm it in the Expectations window.
4. **Model in small Proposals**, one idea each (a site, a supply chain, a backup), every change with a
   \`why\` quoting what they said or starting "Assumed:". Point at what you mean with \`show\`.
5. **Calibrate.** \`run_expectations\`. For each failure read the actual value and its cause, change
   what the system *is* (an edge missing or reversed, a Category, a dependency level, a backup and
   its duration, a capacity, a demand, a priority) and propose again. Prefer topology and
   attributes; write a Specific Rule only for an agreement or procedure the person describes.
   Never rewrite an Expectation to fit the model: if one seems wrong, ask the person.
6. **Answer their questions with runs.** For "what if…" or "which is worth more…", run the
   scenarios or simulations on copies, compare them, and answer in plain words with the numbers:
   what degrades, for how long, why (the chain of causes), and which unconfirmed assumptions the
   answer rests on.

## Talking to the decision maker

- No CASCADE vocabulary unless they use it. Say "how well it works" for Functionality, the scale's
  labels ("critical", "operational") for levels, "what fails next" for a Propagation.
- Never invent a quantity. If a number matters and nobody knows it, say so, propose a range, and
  mark it "Assumed:".
- Their organisation's names leave their computer when they reach you; do not copy them anywhere
  else.

## The tools

${AGENT_TOOLS.map((t) => `- \`${t.name}\`: ${t.description}`).join("\n")}

Without the Agent Bridge (no tools), write your changes in the plain-changes format of
\`reference/changes.md\` as one JSON reply; the person pastes it into LLM Design → Bulk operations,
where it is checked and previewed the same way.
`;

const SETUP_MD = (t: KitTarget) => `# Connecting an agent to CASCADE

The agent reaches the CASCADE tab you have open through the **Agent Bridge**: \`cascade-mcp.mjs\` is a
small MCP server (Node.js 22 or newer, no dependencies) that your agent starts; it connects to
CASCADE with a personal token and passes the agent's tool calls to your tab. The tools run in your
tab with your session, so they see exactly what you see and use your own engine quota.

1. In CASCADE, open **Agent** (Topbar) → **Personal tokens** → **Create**, and copy the token. It is
   shown once. It lets a program reach your open tab: keep it like a password, and revoke it in the
   same place when you are done.
2. Add the server to your agent, with the token. Claude Code:

   \`\`\`
   claude mcp add cascade --env CASCADE_TOKEN=<token> -- node /path/to/cascade-mcp.mjs ${t.apiOrigin}
   \`\`\`

   Claude Desktop, opencode or any MCP client: a stdio server with command \`node\`, arguments
   \`["/path/to/cascade-mcp.mjs", "${t.apiOrigin}"]\` and the environment variable
   \`CASCADE_TOKEN=<token>\`.
3. In CASCADE, open **Agent** → **Pair this tab**. When the agent connects, the window names it:
   press **Approve**. Until you approve, the agent can do nothing. Close the tab, press
   **Disconnect** or revoke the token to end it.
4. Give the agent \`AGENTS.md\` (Claude Code reads it from the folder it runs in).

With a local deployment in local-only mode (no sign-in), no token is needed: set
\`CASCADE_TOKEN=local\`.
`;

/** The kit's files, path → content. `program` is the text of cascade-mcp.mjs, fetched from the deployment. */
export function agentKitFiles(bundle: ProjectBundle, target: KitTarget, program: string): Record<string, string> {
  return {
    "AGENTS.md": AGENTS_MD,
    "SETUP.md": SETUP_MD(target),
    ...Object.fromEntries(Object.entries(REFERENCE_TOPICS).map(([topic, text]) => [`reference/${topic}.md`, text(bundle)])),
    "project/context.md": `${modelContext(bundle)}\n\n(As it was when the kit was downloaded; with the bridge, \`describe_model\` reads it live.)`,
    "mcp/cascade-mcp.mjs": program,
    "mcp/tools.json": JSON.stringify(toolList(), null, 1),
  };
}
