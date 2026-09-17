/**
 * Root layout for the application: the editor at /app, /admin, and the OIDC
 * callback.
 *
 * It keeps the shell the editor has always had — a full-height, non-scrolling
 * page — now expressed only as classes, since `globals.css` no longer imposes
 * `overflow: hidden` on every page (the website scrolls).
 *
 * `productMetadata` marks these routes `noindex`: they are an application
 * behind an identity gate, and the landing page is what should answer a search.
 */

import type { Metadata, Viewport } from "next";
import "../globals.css";
import { productMetadata, siteViewport } from "@/lib/site-metadata";

export const metadata: Metadata = productMetadata;
export const viewport: Viewport = siteViewport;

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      {/* The shell the stylesheet used to impose on every page: the editor's
          typeface and surface colours, now asked for by name. */}
      <body
        suppressHydrationWarning
        className="h-full overflow-hidden bg-zinc-50 font-app text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
      >
        {children}
      </body>
    </html>
  );
}
