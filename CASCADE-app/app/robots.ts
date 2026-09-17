/**
 * /robots.txt, generated at build time (Next writes it into the static export).
 *
 * The landing pages are open to crawlers; the application is closed to them.
 * `/app`, `/admin` and `/auth` render nothing a search result could usefully
 * show, and indexing them would put a login screen in front of anyone searching
 * for what the platform does. The `noindex` header in `(product)/layout.tsx`
 * says the same thing to a crawler that arrives at the page directly.
 */

import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/site-metadata";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/app", "/admin", "/auth"] },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
