"use client";

/**
 * The website's navigation bar.
 *
 * It is dark at every scroll position and in both colour schemes. That is a
 * deliberate choice: the hero band is dark, so a bar that matched the page
 * would have to change appearance on scroll, which needs a scroll listener and
 * a moment of flicker on every load. A bar that is always dark stays put, costs
 * no JavaScript beyond the mobile menu, and reads as the platform's chrome.
 *
 * The one piece of state is the mobile menu, which is why this file is a client
 * component. Everything else on the page is a server component and ships no JS.
 */

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import type { SiteCopy } from "@/lib/site-copy";
import { APP_PATH } from "@/lib/site-copy";

export function SiteHeader({ copy }: { copy: SiteCopy }) {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-100/10 bg-zinc-950/90 backdrop-blur">
      <nav
        className="mx-auto flex w-full max-w-6xl items-center gap-6 px-6 py-3.5 sm:px-8"
        aria-label={copy.nav.menuLabel}
      >
        <Link href={copy.locale === "it" ? "/it" : "/"} className="shrink-0">
          {/* The on-dark lockup: the theme-aware file follows the visitor's
              system setting, which cannot see that this bar is always dark. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- a fixed-size SVG needs no optimisation pipeline */}
          <img src="/logo-horizontal-ondark.svg" alt="CASCADE" width={134} height={32} className="h-8 w-auto" />
        </Link>

        <ul className="ml-auto hidden items-center gap-7 lg:flex">
          {copy.nav.links.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="text-sm text-zinc-400 transition-colors hover:text-zinc-50"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <Link
            href={copy.alternate.href}
            title={copy.alternate.title}
            hrefLang={copy.alternate.locale}
            className="rounded-md px-2.5 py-1.5 text-xs font-semibold tracking-[0.11em] text-zinc-400 transition-colors hover:bg-zinc-100/10 hover:text-zinc-50"
          >
            {copy.alternate.label}
          </Link>
          <Link
            href={APP_PATH}
            className="hidden rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-zinc-50 transition-colors hover:bg-blue-700 sm:inline-flex"
          >
            {copy.nav.openApp}
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={copy.nav.menuLabel}
            className="rounded-md p-2 text-zinc-300 transition-colors hover:bg-zinc-100/10 hover:text-zinc-50 lg:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </nav>

      {open && (
        <ul className="border-t border-zinc-100/10 px-6 pb-4 lg:hidden">
          {copy.nav.links.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                onClick={() => setOpen(false)}
                className="block py-2.5 text-sm text-zinc-300 transition-colors hover:text-zinc-50"
              >
                {link.label}
              </a>
            </li>
          ))}
          <li>
            <Link
              href={APP_PATH}
              className="mt-2 inline-flex rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-zinc-50"
            >
              {copy.nav.openApp}
            </Link>
          </li>
        </ul>
      )}
    </header>
  );
}
