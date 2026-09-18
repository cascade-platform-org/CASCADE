/**
 * Root layout for the Italian website — the twin of `app/(site)/layout.tsx`,
 * differing only in `<html lang>` and in which copy file feeds the metadata.
 *
 * The duplication is the price of a correct `lang` attribute in a static
 * export: a root layout is the only place `<html>` exists, and a locale cannot
 * reach it from the page below.
 */

import type { Metadata, Viewport } from "next";
import "../globals.css";
import { inter } from "../fonts";
import { it } from "@/lib/site-copy";
import { siteMetadata, siteViewport } from "@/lib/site-metadata";
import { ObservabilityInit } from "@/components/observability-init";

export const metadata: Metadata = siteMetadata(it);
export const viewport: Viewport = siteViewport;

export default function SiteLayoutIt({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${inter.className} bg-white text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100`}
      >
        <ObservabilityInit />
        {children}
      </body>
    </html>
  );
}
