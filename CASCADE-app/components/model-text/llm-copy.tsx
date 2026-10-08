"use client";

/**
 * useLlmCopy — every "copy for an LLM" in the app goes through here
 * (requirements §13.3b). Before the first copy it says once where the model
 * goes: pasted into an LLM, the names and structure leave this computer, so a
 * chat that keeps no history, or an LLM running locally, is the private choice.
 * "Don't tell me again" hides it for this browser; nothing else is stored.
 */

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { SmallButton } from "@/components/temporal/fields";
import { useUiStore } from "@/store/ui-store";

const DISMISSED_KEY = "cascade.llm-copy-notice.dismissed";

function dismissed(): boolean {
  try { return localStorage.getItem(DISMISSED_KEY) === "1"; } catch { return false; }
}

function dismiss() {
  try { localStorage.setItem(DISMISSED_KEY, "1"); } catch { /* storage blocked: the notice shows again next time */ }
}

/** Copy a text to the clipboard, with a toast either way. */
export async function copyText(content: string, what: string) {
  const pushToast = useUiStore.getState().pushToast;
  try {
    await navigator.clipboard.writeText(content);
    pushToast({ message: `Copied ${what}.`, variant: "success", durationMs: 2000 });
  } catch {
    pushToast({ message: "The clipboard is blocked; select the text instead.", variant: "warning", durationMs: 3000 });
  }
}

interface Pending {
  content: () => string;
  what: string;
}

/**
 * `copyForLlm(content, what)` copies at once, or first shows the notice the
 * caller renders as `notice`. `content` is built when the copy happens.
 */
export function useLlmCopy() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [never, setNever] = useState(false);

  function copyForLlm(content: () => string, what: string) {
    if (dismissed()) void copyText(content(), what);
    else setPending({ content, what });
  }

  function confirm() {
    if (!pending) return;
    if (never) dismiss();
    void copyText(pending.content(), pending.what);
    setPending(null);
  }

  const notice = pending && (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/30" onClick={() => setPending(null)}>
      <div
        role="dialog"
        aria-label="Before you paste into an LLM"
        onClick={(e) => e.stopPropagation()}
        className="w-[420px] max-w-[calc(100vw-32px)] rounded-lg border border-zinc-200 bg-white p-4 text-xs text-zinc-700 shadow-xl dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
      >
        <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><ShieldAlert size={15} className="text-amber-600 dark:text-amber-400" /> Before you paste into an LLM</p>
        <p className="mb-2">
          What you copy holds your model&apos;s names and structure. Pasted into an LLM, it leaves this computer.
        </p>
        <p className="mb-3">
          Use a chat that keeps no history and is not used for training (a temporary chat), or an LLM that runs on
          your own machine.
        </p>
        <label className="mb-3 flex items-center gap-1.5">
          <input type="checkbox" checked={never} onChange={(e) => setNever(e.target.checked)} />
          Don&apos;t tell me again
        </label>
        <div className="flex justify-end gap-2">
          <SmallButton onClick={() => setPending(null)}>Cancel</SmallButton>
          <SmallButton tone="accent" onClick={confirm}>Copy {pending.what}</SmallButton>
        </div>
      </div>
    </div>
  );

  return { copyForLlm, notice };
}
