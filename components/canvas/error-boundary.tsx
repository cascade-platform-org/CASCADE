"use client";

import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[CASCADE] Uncaught render error:", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-8 shadow-xl dark:border-red-900 dark:bg-zinc-900">
          <div className="mb-4 flex items-center gap-3">
            <AlertTriangle size={22} className="shrink-0 text-red-500" />
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Something went wrong
            </h2>
          </div>
          <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
            CASCADE hit an unexpected error. Your project data is safe — the app
            saves automatically before closing.
          </p>
          {this.state.error && (
            <details className="mb-6">
              <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                Error details
              </summary>
              <pre className="mt-2 overflow-auto rounded-md bg-zinc-100 p-3 text-xs text-red-700 dark:bg-zinc-800 dark:text-red-400">
                {this.state.error.message}
              </pre>
            </details>
          )}
          <button
            onClick={() => window.location.reload()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <RefreshCw size={14} />
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
