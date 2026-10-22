"use client";

/**
 * The Agent window's top section (ADR-0024): download the Agent Kit, pair this
 * tab with the Agent Bridge, approve or decline the agents that ask to connect,
 * and manage the personal tokens they connect with. A token is shown once, when
 * created; revoking it ends every connection made with it at the next attempt.
 */

import { useEffect, useState } from "react";
import JSZip from "jszip";
import { Download, Link2, Unlink, KeyRound, Copy, Trash2, Check, X } from "lucide-react";
import { SmallButton, inputCls } from "@/components/temporal/fields";
import { useAgentStore } from "@/store/agent-store";
import { useUiStore } from "@/store/ui-store";
import { useAuthStore } from "@/store/auth-store";
import { decideAgent, pairTab, unpairTab } from "@/lib/agent-bridge";
import { apiOrigin, createAgentToken, listAgentTokens, revokeAgentToken } from "@/lib/api-client";
import { agentKitFiles, claudeCodeCommand } from "@/lib/agent-kit";
import { currentBundle } from "@/lib/project-bundle";
import { ZIP_FILE, safeName, saveAs } from "@/lib/file-io";
import { copyText } from "@/components/model-text/llm-copy";
import type { AgentToken } from "@/lib/schemas/agent";

/** Build and download the Agent Kit for the open project. */
async function downloadKit() {
  const pushToast = useUiStore.getState().pushToast;
  try {
    const res = await fetch("/agent/cascade-mcp.mjs");
    if (!res.ok) throw new Error(`cascade-mcp.mjs: ${res.status}`);
    const bundle = currentBundle();
    const files = agentKitFiles(bundle, { apiOrigin: apiOrigin() }, await res.text());
    const zip = new JSZip();
    const root = `cascade-agent-kit-${safeName(bundle.project.meta.name)}`;
    for (const [path, content] of Object.entries(files)) zip.file(`${root}/${path}`, content);
    await saveAs(`${root}.zip`, await zip.generateAsync({ type: "blob" }), ZIP_FILE);
  } catch (e) {
    pushToast({ message: `The Agent Kit could not be built: ${e instanceof Error ? e.message : String(e)}`, variant: "warning", durationMs: 4000 });
  }
}

const STATUS_LINE: Record<"off" | "connecting" | "open", string> = {
  off: "Not paired. Press Pair this tab, then start your agent.",
  connecting: "Pairing…",
  open: "This tab is paired and listening. Now start your agent (step 3 above): it will ask for your approval here.",
};

/** How to connect an agent, in the order a person does it; what differs in local-only mode is said in place. */
function HowItWorks({ local }: { local: boolean }) {
  const command = claudeCodeCommand(apiOrigin(), local ? "local" : "<your token>");
  // Open until an agent has been here; after that the Proposals matter more than the steps.
  const [firstTime] = useState(() => useAgentStore.getState().activity.length === 0 && useAgentStore.getState().proposals.length === 0);
  return (
    <details className="mb-2 rounded-md bg-blue-50 px-2 py-1.5 text-[11px] leading-4 text-blue-900 dark:bg-blue-900/20 dark:text-blue-200" open={firstTime}>
      <summary className="cursor-pointer font-medium">How to work with an agent</summary>
      <p className="mt-1">
        An agent is a program <b>you start yourself</b> (Claude Code, Claude Desktop, a model running on your machine). It does not
        live in CASCADE: it reaches this open tab through CASCADE&apos;s server, reads the model, runs scenarios on copies, and
        sends you <b>Proposals</b>. Nothing changes until you apply one.
      </p>
      <ol className="mt-1 list-decimal space-y-1 pl-4">
        <li><b>Agent Kit</b> (button below): download it and unzip it into a folder. It holds the agent&apos;s instructions and the small program that connects it. It needs Node.js 22 or newer on your computer.</li>
        <li>
          {local
            ? <>This CASCADE has no sign-in, so <b>no token is needed</b>: the agent connects with the word <code>local</code>.</>
            : <>Open <b>Personal tokens</b> below, <b>Create</b> one and copy it (shown once). It lets a program reach this tab: keep it like a password.</>}
        </li>
        <li>
          In a terminal <b>inside that folder</b>, start Claude Code and add CASCADE to it (other agents: <code>SETUP.md</code> in the kit):
          <div className="mt-1 flex items-start gap-1">
            <code className="min-w-0 flex-1 break-all rounded bg-white/70 p-1 dark:bg-zinc-900/60">{command}</code>
            <SmallButton onClick={() => void copyText(command, "the command")}><Copy size={12} /></SmallButton>
          </div>
        </li>
        <li><b>Pair this tab</b> (button below). When the agent connects, a card names it: press <b>Approve</b>. Until then it can do nothing.</li>
        <li><b>Once approved</b>, ask the agent for what you want in its own chat (&ldquo;interview me about my hospital&rdquo;). An agent that asks before you approve is told to wait. What it wants to change appears below as a Proposal.</li>
      </ol>
      <p className="mt-1 text-blue-800/80 dark:text-blue-200/70">What you show the agent goes to wherever its LLM runs: choose one you trust with your organisation&apos;s names.</p>
    </details>
  );
}

export function BridgePanel() {
  const local = !useAuthStore((s) => s.authEnabled);
  const bridge = useAgentStore((s) => s.bridge);
  const canPropagate = useAuthStore((s) => s.hasPermission("can_propagate"));
  const agents = useAgentStore((s) => s.agents);
  const working = bridge.status === "open" ? agents.find((a) => a.approved) : undefined;
  const on = bridge.status !== "off" && bridge.status !== "error";

  return (
    <section className="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <HowItWorks local={local} />
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto">
          {working
            ? <span className="text-success">Working with <b>{working.name}</b>. It can read and run on copies; every change waits for you below.</span>
            : bridge.status === "error"
              ? <span className="text-danger">{bridge.message}</span>
              : STATUS_LINE[bridge.status]}
        </p>
        <SmallButton onClick={() => void downloadKit()} title="AGENTS.md, the references, this project's context and the program that connects an agent to this tab">
          <Download size={12} /> Agent Kit
        </SmallButton>
        {on ? (
          <SmallButton onClick={unpairTab}><Unlink size={12} /> Disconnect</SmallButton>
        ) : (
          <SmallButton tone="accent" onClick={pairTab} disabled={!canPropagate} title={canPropagate ? "Let an agent with your token work in this tab" : "Sign in with an account allowed to Propagate"}>
            <Link2 size={12} /> Pair this tab
          </SmallButton>
        )}
      </div>
      {agents.filter((a) => !a.approved).map((a) => (
        <div key={a.id} className="mt-2 flex items-center gap-2 rounded-md border border-amber-200 bg-warning-soft p-2 dark:border-amber-800 dark:bg-amber-900/20">
          <p className="mr-auto">
            <b>{a.name}</b> asks to work in this tab{a.tokenName ? ` (token “${a.tokenName}”)` : ""}. It will see this project and can propose changes; it cannot apply them.
          </p>
          <SmallButton onClick={() => decideAgent(a.id, false)}><X size={12} /> Decline</SmallButton>
          <SmallButton tone="accent" onClick={() => decideAgent(a.id, true)}><Check size={12} /> Approve</SmallButton>
        </div>
      ))}
      {!local && <TokensSection />}
    </section>
  );
}

function TokensSection() {
  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState<AgentToken[] | null>(null);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    listAgentTokens().then((t) => { if (live) setTokens(t); }, (e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [open]);

  async function create() {
    setError(null);
    try {
      const made = await createAgentToken(name.trim() || "Agent");
      setCreated(made.token);
      setTokens((t) => [...(t ?? []), made.record]);
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function revoke(id: string) {
    const why = await revokeAgentToken(id);
    if (why) setError(why);
    else setTokens((t) => (t ?? []).filter((x) => x.id !== id));
  }

  if (!open) {
    return (
      <button type="button" className="mt-1.5 flex items-center gap-1 text-[11px] text-blue-700 hover:underline dark:text-blue-400" onClick={() => setOpen(true)}>
        <KeyRound size={11} /> Personal tokens
      </button>
    );
  }
  return (
    <div className="mt-2 rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
      <p className="mb-1 text-[11px] text-zinc-500">
        A token lets a program you run reach this tab through the Agent Bridge, and nothing else. Keep it like a password; it expires after 30 days.
      </p>
      {created && (
        <div className="mb-2 rounded bg-success-soft p-1.5 dark:bg-green-900/20">
          <p className="mb-1 text-[11px]">Your new token. It is shown only now:</p>
          <div className="flex items-center gap-1">
            <code className="min-w-0 flex-1 break-all text-[11px]">{created}</code>
            <SmallButton onClick={() => void copyText(created, "the token")}><Copy size={12} /></SmallButton>
          </div>
        </div>
      )}
      <div className="mb-2 flex gap-1">
        <input className={inputCls} placeholder="What it is for, e.g. Claude Code on my laptop" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        <SmallButton tone="accent" onClick={() => void create()}>Create</SmallButton>
      </div>
      {error && <p className="mb-1 text-[11px] text-danger">{error}</p>}
      {tokens?.length === 0 && <p className="text-[11px] text-zinc-500">No tokens.</p>}
      {tokens?.map((t) => (
        <div key={t.id} className="flex items-center gap-2 text-[11px]">
          <span className="mr-auto truncate">{t.name}</span>
          <span className="text-zinc-400">used {t.last_used_at ? new Date(t.last_used_at).toLocaleDateString() : "never"} · expires {new Date(t.expires_at).toLocaleDateString()}</span>
          <SmallButton tone="danger" onClick={() => void revoke(t.id)} title="Revoke"><Trash2 size={12} /></SmallButton>
        </div>
      ))}
    </div>
  );
}
