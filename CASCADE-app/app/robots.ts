/**
 * /robots.txt, generated at build time (Next writes it into the static export).
 *
 * Everything is crawlable, and the application is kept out of search results by
 * the `noindex` in `(product)/layout.tsx` instead. The two cannot be combined: a
 * crawler that is disallowed from `/app` never downloads it, so it never reads
 * the `noindex`, and a URL the landing page links to then gets indexed anyway
 * as a bare "blocked by robots.txt" entry. Letting it crawl is what lets the
 * `noindex` take the application out of the index.
 */

import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/site-metadata";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
