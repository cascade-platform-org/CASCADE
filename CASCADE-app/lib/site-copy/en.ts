/**
 * English copy for the public website.
 *
 * Vocabulary is CONTEXT.md's: Element, Canvas, Category, Event, Propagation.
 * The page is short by design — see the note in `types.ts` — so it leans on
 * precision rather than volume: every sentence here has to earn its place in
 * four bands (hero, research, contact, footer).
 *
 * Two prose rules the owner holds across the whole project apply here as much
 * as they do to the papers: state the positive claim on its own (no "X, not Y")
 * and never write against an alternative the reader has not been shown.
 */

import type { SiteCopy } from "./types";
import { LINKS } from "./links";

export const en: SiteCopy = {
  locale: "en",
  htmlLang: "en",
  alternate: { locale: "it", label: "IT", href: "/it", title: "Leggi in italiano" },

  meta: {
    title: "CASCADE — cascading failure modelling for interdependent critical infrastructure",
    description:
      "Open-source platform for modelling any network of interdependent services as one system, then propagating a failure through it to see what else stops working.",
    path: "/",
  },

  nav: {
    skipToContent: "Skip to content",
    links: [
      { label: "Research", href: "#research" },
      { label: "Contact", href: "#contact" },
    ],
    openApp: "Open the platform",
    menuLabel: "Menu",
  },

  hero: {
    eyebrow: "Open-source resilience modelling",
    title: "Failures don't stay where they start.",
    lead: "CASCADE turns a network of interdependent services into one model, then propagates a failure through it step by step — so the cascade can be read before it happens.",
    trust: ["AGPL-3.0", "Local-first — your model stays in your browser"],
    primaryCta: "Open the platform",
    secondaryCta: "View the source",
    demoCaption:
      "The CASCADE canvas editor: Elements, Categories, an Event, and the Propagation that follows.",
  },

  research: {
    eyebrow: "Research",
    title: "Publications",
    papers: [
      {
        title: "Composable, Knowledge-Driven Disservice Propagation for Complex Interdependent Services",
        note: "The propagation architecture, the flow module, and the EPANET importer validated against WNTR.",
      },
      {
        title: "Series and Parallel Dependency Links: Vitality for Interdependent Networks of Networks",
        note: "Two links entering a node are alternatives when they carry the same service, and both required when they carry different ones. Node importance follows from that reading.",
      },
      {
        title: "Customizable Assessment of System Cascades And Dependency Effects for Improving Resilience of Interdependent Essential Services",
        note: "The framework end to end, demonstrated on a multi-utility network under an earthquake, a flood and a digital attack.",
      },
    ],
    footnote:
      "These are preprints — pre-refereeing versions of manuscripts under review. Every reported number recomputes from the result files in the repository.",
    link: { label: "From the papers to the code", href: LINKS.papers, external: true },
  },

  contact: {
    eyebrow: "Contact",
    title: "Work together.",
    lead: "CASCADE is developed by Cristian Curaba at the University of Udine. Write if you want to map your organisation's dependencies, collaborate on the research, or learn to use the platform properly.",
    cards: [
      {
        title: "Research collaboration",
        body: "Joint work on propagation modelling and measures for interdependent networks, or validating the engine against data you already hold.",
        subject: "CASCADE — research collaboration",
      },
      {
        title: "A modelling session",
        body: "A guided mapping of your organisation as a network of dependencies, run with the people who operate the services day to day. You keep the model and the results.",
        subject: "CASCADE — modelling session",
      },
      {
        title: "Tutoring and training",
        body: "Learn the method and the platform — for a team, a course, or a thesis that needs a model behind it.",
        subject: "CASCADE — tutoring and training",
      },
    ],
    emailCta: "Write to",
  },

  footer: {
    tagline: "Modelling how service loss cascades across interdependent essential services.",
    groups: [
      {
        title: "Platform",
        links: [
          { label: "Open the platform", href: "/app" },
          { label: "User manual", href: LINKS.userManual, external: true },
          { label: "Architecture", href: LINKS.architecture, external: true },
          { label: "Glossary", href: LINKS.glossary, external: true },
        ],
      },
      {
        title: "Research",
        links: [
          { label: "Papers and code", href: LINKS.papers, external: true },
          { label: "Benchmark protocol", href: LINKS.benchmarks, external: true },
          { label: "Cite CASCADE", href: LINKS.citation, external: true },
        ],
      },
      {
        title: "Project",
        links: [
          { label: "Source on GitHub", href: LINKS.repo, external: true },
          { label: "Licence — AGPL-3.0", href: LINKS.licence, external: true },
          { label: "Privacy and data protection", href: LINKS.privacy, external: true },
        ],
      },
    ],
    languageLabel: "Language",
    legal: "© 2026 Cristian Curaba. Published under the GNU Affero General Public License v3.",
  },
};
