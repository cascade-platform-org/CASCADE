/**
 * The website's footer: the links a reader who scrolled the whole page is
 * looking for, plus the licence line.
 *
 * The documentation links leave for GitHub, because the docs live in the
 * repository and the site is a static export with no doc renderer. They are
 * collected in `lib/site-copy/links.ts` so both locales point at the same URLs.
 */

import Link from "next/link";
import { Mail } from "lucide-react";
import type { SiteCopy } from "@/lib/site-copy";
import { CONTACT_EMAIL, mailto } from "@/lib/site-copy";
import { Container, CopyLink, GithubMark } from "./primitives";
import { LINKS } from "@/lib/site-copy";

export function SiteFooter({ copy }: { copy: SiteCopy }) {
  return (
    <footer className="border-t border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
      <Container className="py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element -- a fixed-size SVG needs no optimisation pipeline */}
            <img
              src="/logo-horizontal.svg"
              alt="CASCADE"
              width={134}
              height={32}
              className="h-8 w-auto"
            />
            <p className="mt-4 max-w-xs text-sm/6 text-zinc-500">{copy.footer.tagline}</p>
            <div className="mt-5 flex items-center gap-4">
              <a
                href={LINKS.repo}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub"
                className="text-zinc-500 transition-colors hover:text-accent"
              >
                <GithubMark className="size-5" />
              </a>
              <a
                href={mailto("CASCADE")}
                aria-label={CONTACT_EMAIL}
                className="text-zinc-500 transition-colors hover:text-accent"
              >
                <Mail className="size-5" />
              </a>
            </div>
          </div>

          {copy.footer.groups.map((group) => (
            <div key={group.title}>
              <h3 className="text-xs font-semibold uppercase tracking-[0.11em] text-zinc-900 dark:text-zinc-100">
                {group.title}
              </h3>
              <ul className="mt-4 space-y-2.5">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <CopyLink link={link} className="text-sm" />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-zinc-200 pt-6 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
          <p>{copy.footer.legal}</p>
          <p className="flex items-center gap-2">
            <span className="text-zinc-400">{copy.footer.languageLabel}</span>
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">
              {copy.locale.toUpperCase()}
            </span>
            <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">
              ·
            </span>
            <Link
              href={copy.alternate.href}
              hrefLang={copy.alternate.locale}
              title={copy.alternate.title}
              className="underline-offset-4 transition-colors hover:text-accent hover:underline"
            >
              {copy.alternate.label}
            </Link>
          </p>
        </div>
      </Container>
    </footer>
  );
}
