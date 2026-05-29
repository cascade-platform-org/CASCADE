"use client";

import { useState } from "react";
import { NewProjectWizard } from "@/components/onboarding/new-project-wizard";
import { EditorShell } from "@/components/canvas/editor-shell";

type AppState = "wizard" | "editor";

export default function Home() {
  const [appState, setAppState] = useState<AppState>("wizard");

  if (appState === "wizard") {
    return (
      <NewProjectWizard
        onComplete={() => setAppState("editor")}
        onCancel={() => {/* no-op: wizard is the only entry point */}}
      />
    );
  }

  return <div className="h-full"><EditorShell /></div>;
}
