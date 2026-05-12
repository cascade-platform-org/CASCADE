"use client";

/**
 * NewProjectWizard — guides first-time users through creating a project.
 *
 * Steps:
 *   1. Name & description
 *   2. Config source: upload existing config | built-in template | blank
 *   3. First canvas setup: name, georeferenced toggle, CRS
 *   4. (Optional) load a sample network
 *
 * On completion the caller receives a ready-to-use Project + ProjectConfig
 * pair and should hydrate the network-store and config-store accordingly.
 *
 * TODO: implement step bodies, validation, and store hydration.
 *       The component structure and prop contract are stable.
 */

import { useState } from "react";

type WizardStep = 1 | 2 | 3 | 4;

interface NewProjectWizardProps {
  /** Called with the final project + config once the user clicks "Create project". */
  onComplete: () => void;
  onCancel: () => void;
}

export function NewProjectWizard({ onComplete, onCancel }: NewProjectWizardProps) {
  const [step, setStep] = useState<WizardStep>(1);

  const advance = () => {
    if (step < 4) setStep((s) => (s + 1) as WizardStep);
    else onComplete();
  };

  const retreat = () => {
    if (step > 1) setStep((s) => (s - 1) as WizardStep);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white p-8 shadow-2xl dark:bg-zinc-900">
        <WizardProgress step={step} />
        <WizardHeader step={step} />
        <WizardBody step={step} />
        <WizardFooter
          step={step}
          onBack={retreat}
          onNext={advance}
          onCancel={onCancel}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function WizardProgress({ step }: { step: WizardStep }) {
  return (
    <div className="mb-6 flex gap-1.5">
      {([1, 2, 3, 4] as WizardStep[]).map((s) => (
        <div
          key={s}
          className={`h-1 flex-1 rounded-full transition-colors ${
            s <= step ? "bg-blue-600" : "bg-zinc-200 dark:bg-zinc-700"
          }`}
        />
      ))}
    </div>
  );
}

const STEP_TITLES: Record<WizardStep, string> = {
  1: "Name your project",
  2: "Choose a configuration",
  3: "Set up your first canvas",
  4: "Load a sample network",
};

const STEP_SUBTITLES: Record<WizardStep, string> = {
  1: "You can rename it at any time.",
  2: "The configuration defines your functionality scale, categories, and hazards.",
  3: "A canvas is one layer of your infrastructure network.",
  4: "Skip this step to start with a blank canvas.",
};

function WizardHeader({ step }: { step: WizardStep }) {
  return (
    <div className="mb-6">
      <p className="mb-0.5 text-xs font-medium uppercase tracking-widest text-zinc-400">
        Step {step} of 4
      </p>
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
        {STEP_TITLES[step]}
      </h2>
      <p className="mt-1 text-sm text-zinc-500">{STEP_SUBTITLES[step]}</p>
    </div>
  );
}

function WizardBody({ step }: { step: WizardStep }) {
  // TODO: replace each placeholder with the real form for that step.
  return (
    <div className="mb-8 min-h-[160px] rounded-xl border-2 border-dashed border-zinc-200 p-6 dark:border-zinc-700">
      <p className="text-sm text-zinc-400">
        Step {step} form — not yet implemented.
      </p>
    </div>
  );
}

interface WizardFooterProps {
  step: WizardStep;
  onBack: () => void;
  onNext: () => void;
  onCancel: () => void;
}

function WizardFooter({ step, onBack, onNext, onCancel }: WizardFooterProps) {
  return (
    <div className="flex items-center justify-between">
      <button
        onClick={onCancel}
        className="text-sm text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
      >
        Cancel
      </button>
      <div className="flex gap-2">
        {step > 1 && (
          <button
            onClick={onBack}
            className="rounded-lg border px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Back
          </button>
        )}
        <button
          onClick={onNext}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {step === 4 ? "Create project" : "Next"}
        </button>
      </div>
    </div>
  );
}
