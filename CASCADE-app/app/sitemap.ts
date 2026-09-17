/**
 * /sitemap.xml, generated at build time.
 *
 * Two entries, each naming the other as its translation, which is how a search
 * engine learns the pages are a pair rather than duplicates competing for the
 * same query.
 */

import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/site-metadata";

export const dynamic = "force-static";

const LANGUAGES = {
  en: `${SITE_ORIGIN}/`,
  it: `${SITE_ORIGIN}/it`,
};

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    {
      url: `${SITE_ORIGIN}/`,
      lastModified,
      changeFrequency: "monthly",
      priority: 1,
      alternates: { languages: LANGUAGES },
    },
    {
      url: `${SITE_ORIGIN}/it`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.8,
      alternates: { languages: LANGUAGES },
    },
  ];
}
