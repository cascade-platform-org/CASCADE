/**
 * Page metadata shared by the three root layouts.
 *
 * WHY THREE ROOT LAYOUTS: `<html lang>` can only be set in a root layout, and
 * the site is published in two languages while the editor needs a body that
 * does not scroll. Route groups let each of the three have its own root layout
 * (`app/(site)`, `app/(site-it)`, `app/(product)`), and this module holds
 * everything they would otherwise repeat.
 *
 * The public origin arrives as a build-time value: a static export has already
 * written its <meta> tags by the time Caddy serves them, so it cannot be a
 * runtime variable. `||` rather than `??` because the Docker build passes an
 * empty string when it is unset, and `new URL("")` throws.
 */

import type { Metadata, Viewport } from "next";
import { brandColor } from "@/lib/brand";
import type { SiteCopy } from "@/lib/site-copy";

export const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

/** Shared by every root layout — the browser chrome colour in each scheme. */
export const siteViewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: brandColor("neutral", 50) },
    { media: "(prefers-color-scheme: dark)", color: brandColor("neutral", 950) },
  ],
};

const OG_IMAGE = { url: "/og.png", width: 1200, height: 630, alt: "CASCADE" };

/**
 * Both locales advertise each other, and the English page is `x-default`.
 * Stated on every page, because a search engine only pairs two translations
 * when each one names the other.
 */
const LANGUAGES = { en: "/", it: "/it", "x-default": "/" } as const;

/** Metadata for one locale's landing page. */
export function siteMetadata(copy: SiteCopy): Metadata {
  return {
    metadataBase: new URL(SITE_ORIGIN),
    title: copy.meta.title,
    description: copy.meta.description,
    applicationName: "CASCADE",
    manifest: "/manifest.webmanifest",
    alternates: { canonical: copy.meta.path, languages: LANGUAGES },
    openGraph: {
      title: copy.meta.title,
      description: copy.meta.description,
      siteName: "CASCADE",
      type: "website",
      locale: copy.locale === "it" ? "it_IT" : "en_GB",
      url: copy.meta.path,
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: copy.meta.title,
      description: copy.meta.description,
      images: [OG_IMAGE.url],
    },
  };
}

/**
 * Metadata for the editor, /admin and the OIDC callback.
 *
 * `noindex` is the point: these routes are an application behind an identity
 * gate, they render nothing a search result could usefully show, and indexing
 * them would compete with the landing page for the same terms. The pages
 * themselves are client components and so cannot export metadata — this layout
 * is a server component and can.
 */
export const productMetadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: { default: "CASCADE", template: "%s · CASCADE" },
  description:
    "Multi-canvas infrastructure failure propagation platform — model interdependent services and analyse how failures cascade across their Elements.",
  applicationName: "CASCADE",
  manifest: "/manifest.webmanifest",
  robots: { index: false, follow: false },
};

/**
 * Schema.org description of the platform, emitted once per landing page.
 *
 * Returned as a string for `dangerouslySetInnerHTML`, which is how a JSON-LD
 * block has to be written: it is data inside a script tag, so React must leave
 * it unescaped. The content is built here from constants — no user input ever
 * reaches it.
 */
export function structuredData(copy: SiteCopy, repoUrl: string, email: string): string {
  const graph = [
    {
      "@type": "SoftwareApplication",
      name: "CASCADE",
      applicationCategory: "SimulationApplication",
      operatingSystem: "Web browser",
      description: copy.meta.description,
      url: SITE_ORIGIN,
      codeRepository: repoUrl,
      license: "https://www.gnu.org/licenses/agpl-3.0.html",
      isAccessibleForFree: true,
      inLanguage: copy.htmlLang,
      author: {
        "@type": "Person",
        name: "Cristian Curaba",
        affiliation: { "@type": "Organization", name: "University of Udine" },
        email,
      },
    },
    {
      "@type": "WebSite",
      name: "CASCADE",
      url: SITE_ORIGIN,
      inLanguage: copy.htmlLang,
      description: copy.meta.description,
    },
  ];
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph });
}
