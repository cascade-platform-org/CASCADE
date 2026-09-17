/**
 * Inter, self-hosted.
 *
 * It is the wordmark's typeface (docs/brand.md), so the website and the mark
 * finally set in the same face. The variable `woff2` is committed under
 * `app/fonts/` and loaded through `next/font/local` rather than fetched from a
 * font CDN at build time: the build stays reproducible offline, and no third
 * party is contacted when a visitor loads the page — the same reasoning that
 * keeps Google's mark inlined in the auth gate.
 *
 * Inter is licensed under the SIL Open Font License 1.1, whose text sits beside
 * the font file. `display: swap` shows the fallback immediately, so the hero
 * headline never waits on a font download.
 */

import localFont from "next/font/local";

export const inter = localFont({
  src: "./fonts/Inter-Variable.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-inter",
  fallback: ["system-ui", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
});
