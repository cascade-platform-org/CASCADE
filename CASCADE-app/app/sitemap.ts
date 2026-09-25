/**
 * /sitemap.xml, generated at build time.
 *
 * Two entries, each naming the other as its translation, which is how a search
 * engine learns the pages are a pair rather than duplicates competing for the
 * same query.
 *
 * No `lastmod`: the only date a build knows is its own, and a `lastmod` that
 * moves on every deploy whether or not the copy changed teaches a search engine
 * to ignore the field. `changefreq` and `priority` are ignored by Google.
 */

import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/site-metadata";

export const dynamic = "force-static";

const LANGUAGES = {
  en: `${SITE_ORIGIN}/`,
  it: `${SITE_ORIGIN}/it`,
};

export default function sitemap(): MetadataRoute.Sitemap {
  return Object.values(LANGUAGES).map((url) => ({
    url,
    alternates: { languages: LANGUAGES },
  }));
}
