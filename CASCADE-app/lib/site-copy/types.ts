/**
 * The shape of every string on the public website.
 *
 * WHY THIS FILE EXISTS: the site ships in English and Italian, and the two
 * versions have to stay in step. Rather than trusting a translator (or a future
 * self) to notice that a new section was added, the copy is data with one type:
 * `en.ts` and `it.ts` both satisfy `SiteCopy`, so adding a field to the English
 * page fails `tsc` until the Italian page has it too. The components then take
 * copy as a prop and contain no prose at all, which is also what keeps a
 * translation from needing a component change.
 *
 * THE PAGE IS DELIBERATELY SHORT: hero, research, contact, footer. A first
 * draft carried a feature-by-feature tour of the platform (multi-canvas,
 * rules, EPANET import, analysis…) and read as a SaaS template rather than as
 * a research group's page — a stakeholder landing here should meet the
 * argument and the evidence, not a capability list. The platform speaks for
 * itself once opened; this page's job is to get a reader to open it, or to
 * read the papers.
 *
 * Nothing here is user data or engine data — it is the marketing surface, so it
 * is deliberately *not* derived from the Pydantic/Zod schemas (CLAUDE.md §6
 * governs the model, not the brochure).
 */

/** The two locales the site is published in. */
type Locale = "en" | "it";

export interface SiteLink {
  label: string;
  href: string;
  /** Set for links that leave the site — the renderer adds rel/target and a mark. */
  external?: boolean;
}

export interface SiteCopy {
  locale: Locale;
  /** The `<html lang>` and `hreflang` value for this locale. */
  htmlLang: string;
  /** The other locale, for the language switch. */
  alternate: { locale: Locale; label: string; href: string; title: string };

  meta: {
    title: string;
    description: string;
    /** Path of this locale's page, used for the canonical URL. */
    path: string;
  };

  nav: {
    skipToContent: string;
    links: SiteLink[];
    openApp: string;
    menuLabel: string;
  };

  hero: {
    eyebrow: string;
    title: string;
    lead: string;
    /** Short facts under the lead — no icons, just plain text. */
    trust: string[];
    primaryCta: string;
    secondaryCta: string;
    /** Alt text for the screen recording embedded right under the CTA row. */
    demoCaption: string;
  };

  research: {
    eyebrow: string;
    title: string;
    papers: { title: string; note: string }[];
    footnote: string;
    link: SiteLink;
  };

  contact: {
    eyebrow: string;
    title: string;
    lead: string;
    /** Each card opens the mail client with its own prefilled subject. */
    cards: { title: string; body: string; subject: string }[];
    emailCta: string;
  };

  footer: {
    tagline: string;
    groups: { title: string; links: SiteLink[] }[];
    languageLabel: string;
    legal: string;
  };
}
