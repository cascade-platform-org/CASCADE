/**
 * The landing page, composed from one locale's copy.
 *
 * Both locale routes render this component with a different `SiteCopy`, so a
 * translation never needs a component change — and a section added here fails
 * the build until both copy files carry its strings (`lib/site-copy/types.ts`).
 *
 * FOUR BANDS, ON PURPOSE: hero, research, contact, footer. An earlier version
 * carried a feature-by-feature platform tour (multi-canvas, rules, EPANET
 * import, the engine's internals…) and read as a SaaS template rather than as
 * a research group's page. A stakeholder who has never heard of CASCADE should
 * meet the argument and the evidence, not a capability list — the platform
 * itself is one click away behind "Open the platform," and it explains itself
 * far better than a marketing page can. What stays is what a reader actually
 * needs before deciding whether to click: what the problem is (hero), why the
 * claims can be trusted (research), and how to reach the person behind it
 * (contact).
 *
 * VISUAL DISCIPLINE: no card backgrounds, no drop shadows, no colour used as
 * decoration. Sections are separated by a hairline rule and whitespace, not by
 * alternating background colour. Colour is spent on exactly two things: the
 * accent for the one interactive thing per view, and red for the one idea the
 * page carries — something failed.
 *
 * Every band below is a server component: the prose is in the static HTML that
 * `next build` writes, which is what makes the page indexable. The one client
 * component on the page is the header's mobile menu.
 */

import Link from "next/link";
import { ArrowRight, Mail } from "lucide-react";
import type { SiteCopy } from "@/lib/site-copy";
import { APP_PATH, LINKS, CONTACT_EMAIL, mailto } from "@/lib/site-copy";
import { Band, ButtonLink, Container, CopyLink, Eyebrow, GithubMark, SectionHead } from "./primitives";
import { HeroCrack } from "./hero-crack";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";

/* ── Hero ─────────────────────────────────────────────────────────────── */

function Hero({ copy }: { copy: SiteCopy }) {
  return (
    <section className="relative overflow-hidden bg-zinc-950">
      <HeroCrack />
      <Container className="relative py-24 sm:py-28 lg:py-32">
        <div className="max-w-2xl">
          <Eyebrow dark>{copy.hero.eyebrow}</Eyebrow>
          <h1 className="mt-4 text-4xl font-medium tracking-tight text-balance text-zinc-50 sm:text-5xl lg:text-[3.4rem] lg:leading-[1.08]">
            {copy.hero.title}
          </h1>
          <p className="mt-7 text-lg/8 text-pretty text-zinc-400">{copy.hero.lead}</p>

          <p className="mt-6 text-sm text-zinc-500">
            {copy.hero.trust.map((item, i) => (
              <span key={item}>
                {i > 0 && <span className="mx-2.5 text-zinc-700">·</span>}
                {item}
              </span>
            ))}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
            <ButtonLink href={APP_PATH}>
              {copy.hero.primaryCta}
              <ArrowRight className="size-4" aria-hidden="true" />
            </ButtonLink>
            <ButtonLink href={LINKS.repo} tone="ghostOnDark">
              <GithubMark className="size-4" />
              {copy.hero.secondaryCta}
            </ButtonLink>
          </div>
        </div>

        <figure className="relative mt-16">
          <div className="overflow-hidden rounded-lg border border-zinc-100/10">
            {/* eslint-disable-next-line @next/next/no-img-element -- an animated GIF has nothing for next/image to optimise */}
            <img
              src="/platform.gif"
              alt={copy.hero.demoCaption}
              loading="eager"
              decoding="async"
              className="w-full"
            />
          </div>
          <figcaption className="mt-4 text-sm text-zinc-500">{copy.hero.demoCaption}</figcaption>
        </figure>
      </Container>
    </section>
  );
}

/* ── Research ─────────────────────────────────────────────────────────── */

function Research({ copy }: { copy: SiteCopy }) {
  return (
    <Band id="research">
      <Container>
        <SectionHead eyebrow={copy.research.eyebrow} title={copy.research.title} />

        <ul className="mt-12 divide-y divide-zinc-200 border-t border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {copy.research.papers.map((paper) => (
            <li key={paper.title} className="py-6">
              <h3 className="text-base font-medium text-balance text-zinc-900 dark:text-zinc-100">
                {paper.title}
              </h3>
              <p className="mt-1.5 text-sm/7 text-zinc-600 dark:text-zinc-400">{paper.note}</p>
            </li>
          ))}
        </ul>

        <p className="mt-8 max-w-3xl text-sm/7 text-zinc-500">{copy.research.footnote}</p>
        <p className="mt-4">
          <CopyLink link={copy.research.link} className="text-sm font-medium" />
        </p>
      </Container>
    </Band>
  );
}

/* ── Contact ──────────────────────────────────────────────────────────── */

function Contact({ copy }: { copy: SiteCopy }) {
  return (
    <Band id="contact" className="bg-zinc-950">
      <Container>
        <SectionHead
          dark
          eyebrow={copy.contact.eyebrow}
          title={copy.contact.title}
          body={copy.contact.lead}
        />

        <ul className="mt-14 divide-y divide-zinc-100/10 border-t border-zinc-100/10">
          {copy.contact.cards.map((card) => (
            <li key={card.title}>
              <a
                href={mailto(card.subject)}
                className="group flex flex-col gap-1.5 py-6 sm:flex-row sm:items-baseline sm:gap-8"
              >
                <h3 className="text-base font-medium text-zinc-100 sm:w-56 sm:shrink-0">
                  {card.title}
                </h3>
                <p className="flex-1 text-sm/7 text-zinc-400">{card.body}</p>
                <ArrowRight
                  className="hidden size-4 shrink-0 self-center text-zinc-600 transition-transform group-hover:translate-x-1 group-hover:text-zinc-300 sm:block"
                  aria-hidden="true"
                />
              </a>
            </li>
          ))}
        </ul>

        <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-4 border-t border-zinc-100/10 pt-8">
          <a
            href={mailto("CASCADE")}
            className="inline-flex items-center gap-2 text-sm font-medium text-zinc-300 transition-colors hover:text-zinc-50"
          >
            <Mail className="size-4" aria-hidden="true" />
            {CONTACT_EMAIL}
          </a>
          <Link
            href={APP_PATH}
            className="inline-flex items-center gap-2 text-sm font-medium text-zinc-300 transition-colors hover:text-zinc-50"
          >
            {copy.nav.openApp}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </Container>
    </Band>
  );
}

/* ── The page ─────────────────────────────────────────────────────────── */

export function Landing({ copy }: { copy: SiteCopy }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-zinc-50"
      >
        {copy.nav.skipToContent}
      </a>
      <SiteHeader copy={copy} />
      <main id="main">
        <Hero copy={copy} />
        <Research copy={copy} />
        <Contact copy={copy} />
      </main>
      <SiteFooter copy={copy} />
    </>
  );
}
