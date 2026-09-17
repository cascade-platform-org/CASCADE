/**
 * Root layout for the English website.
 *
 * One of three root layouts (see `lib/site-metadata.ts` for why). This one owns
 * `<html lang="en">` and a body that scrolls; the Italian layout is its twin,
 * and `(product)` carries the editor's fixed shell.
 */

import type { Metadata, Viewport } from "next";
import "../globals.css";
import { inter } from "../fonts";
import { en } from "@/lib/site-copy";
import { siteMetadata, siteViewport } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata(en);
export const viewport: Viewport = siteViewport;

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${inter.className} bg-white text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100`}
      >
        {children}
      </body>
    </html>
  );
}
