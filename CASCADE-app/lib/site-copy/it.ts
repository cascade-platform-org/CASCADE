/**
 * Italian copy for the public website.
 *
 * A translation of the argument, rather than of the sentences. Platform nouns
 * that the reader will meet in the interface stay in English (Canvas, Element,
 * Category, Event, Propagation), because the editor itself is in English and
 * an invented Italian label would map to nothing on screen.
 *
 * The same prose rules as the English file: the positive claim on its own, and
 * nothing written against an alternative the reader has not been shown.
 */

import type { SiteCopy } from "./types";
import { LINKS } from "./links";

export const it: SiteCopy = {
  locale: "it",
  htmlLang: "it",
  alternate: { locale: "en", label: "EN", href: "/", title: "Read in English" },

  meta: {
    title: "CASCADE — modellazione dei guasti a cascata nelle infrastrutture critiche interdipendenti",
    description:
      "Piattaforma open source per modellare qualunque rete di servizi interdipendenti come un unico sistema, e propagarvi un guasto per vedere che cosa smette di funzionare.",
    path: "/it",
  },

  nav: {
    skipToContent: "Vai al contenuto",
    links: [
      { label: "Ricerca", href: "#research" },
      { label: "Contatti", href: "#contact" },
    ],
    openApp: "Apri la piattaforma",
    menuLabel: "Menu",
  },

  hero: {
    eyebrow: "Modellazione della resilienza, open source",
    title: "I guasti non restano dove nascono.",
    lead: "CASCADE trasforma una rete di servizi interdipendenti in un unico modello, poi vi propaga un guasto passo dopo passo — così la cascata si legge prima che accada.",
    trust: ["AGPL-3.0", "Local-first — il modello resta nel tuo browser"],
    primaryCta: "Apri la piattaforma",
    secondaryCta: "Vedi il codice",
    demoCaption:
      "L'editor di CASCADE: Elementi, Categorie, un Evento, e la Propagazione che ne consegue.",
  },

  research: {
    eyebrow: "Ricerca",
    title: "Pubblicazioni",
    papers: [
      {
        title: "Composable, Knowledge-Driven Disservice Propagation for Complex Interdependent Services",
        note: "L'architettura di propagazione, il modulo di flusso e l'importatore EPANET validato contro WNTR.",
      },
      {
        title: "Series and Parallel Dependency Links: Vitality for Interdependent Networks of Networks",
        note: "Due collegamenti che entrano in un nodo sono alternative quando portano lo stesso servizio, ed entrambi necessari quando ne portano di diversi. L'importanza del nodo discende da questa lettura.",
      },
      {
        title: "Customizable Assessment of System Cascades And Dependency Effects for Improving Resilience of Interdependent Essential Services",
        note: "Il framework dall'inizio alla fine, dimostrato su una rete multi-servizio sotto un terremoto, un allagamento e un attacco informatico.",
      },
    ],
    footnote:
      "Sono preprint: versioni precedenti alla revisione paritaria di manoscritti in valutazione. Ogni numero riportato si ricalcola dai file di risultato nel repository.",
    link: { label: "Dagli articoli al codice", href: LINKS.papers, external: true },
  },

  contact: {
    eyebrow: "Contatti",
    title: "Lavoriamo insieme.",
    lead: "CASCADE è sviluppato da Cristian Curaba all'Università degli Studi di Udine. Scrivi se vuoi mappare le dipendenze della tua organizzazione, collaborare alla ricerca, o imparare a usare la piattaforma per davvero.",
    cards: [
      {
        title: "Collaborazione di ricerca",
        body: "Lavoro congiunto sulla modellazione della propagazione e sulle misure per reti interdipendenti, o validazione del motore sui dati che già possiedi.",
        subject: "CASCADE — collaborazione di ricerca",
      },
      {
        title: "Una sessione di mappatura",
        body: "Una mappatura guidata della tua organizzazione come rete di dipendenze, condotta con le persone che gestiscono i servizi ogni giorno. Il modello e i risultati restano tuoi.",
        subject: "CASCADE — sessione di mappatura",
      },
      {
        title: "Formazione e tutoraggio",
        body: "Impara il metodo e la piattaforma — per una squadra, un corso, o una tesi che ha bisogno di un modello alle spalle.",
        subject: "CASCADE — formazione e tutoraggio",
      },
    ],
    emailCta: "Scrivi a",
  },

  footer: {
    tagline: "Modellare come la perdita di servizio si propaga fra servizi essenziali interdipendenti.",
    groups: [
      {
        title: "Piattaforma",
        links: [
          { label: "Apri la piattaforma", href: "/app" },
          { label: "Manuale utente", href: LINKS.userManual, external: true },
          { label: "Architettura", href: LINKS.architecture, external: true },
          { label: "Glossario", href: LINKS.glossary, external: true },
        ],
      },
      {
        title: "Ricerca",
        links: [
          { label: "Articoli e codice", href: LINKS.papers, external: true },
          { label: "Protocollo di benchmark", href: LINKS.benchmarks, external: true },
          { label: "Cita CASCADE", href: LINKS.citation, external: true },
        ],
      },
      {
        title: "Progetto",
        links: [
          { label: "Codice su GitHub", href: LINKS.repo, external: true },
          { label: "Licenza — AGPL-3.0", href: LINKS.licence, external: true },
          { label: "Privacy e protezione dei dati", href: LINKS.privacy, external: true },
        ],
      },
    ],
    languageLabel: "Lingua",
    legal: "© 2026 Cristian Curaba. Pubblicato sotto GNU Affero General Public License v3.",
  },
};
