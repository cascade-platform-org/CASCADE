/**
 * The website's small shared pieces.
 *
 * The visual discipline here is restraint: no card backgrounds, no drop
 * shadows, no colour used as decoration. A section is separated from the next
 * by a hairline rule and whitespace, not by a change of background colour —
 * a page that alternates grey/white bands reads as a template; a continuous
 * page with quiet dividers reads as considered. Colour is reserved for the
 * one thing it has to mean: the accent for something interactive, red for
 * something failed. Everything else is ink on paper.
 *
 * Colour comes from ramp classes and semantic tokens only: there is no hex
 * anywhere on the site, and `lib/no-hex-literals.test.ts` keeps it that way.
 */

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { clsx } from "clsx";
import type { SiteLink } from "@/lib/site-copy";

/** Page gutter and maximum measure, shared by every band. */
export function Container({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("mx-auto w-full max-w-6xl px-6 sm:px-8", className)}>{children}</div>
  );
}

/**
 * A section wrapper with the standard vertical rhythm.
 *
 * `divide` draws the hairline that separates it from the section above —
 * every light-mode band uses it except the first, so the page reads as one
 * continuous sheet rather than a stack of coloured cards.
 */
export function Band({
  id,
  children,
  className,
  divide,
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
  divide?: boolean;
}) {
  return (
    <section
      id={id}
      className={clsx(
        "scroll-mt-20 py-20 sm:py-28",
        divide && "border-t border-zinc-200 dark:border-zinc-800",
        className,
      )}
    >
      {children}
    </section>
  );
}

/** The small caps label above a section heading — quiet, never coloured. */
export function Eyebrow({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <p
      className={clsx(
        "text-xs font-medium uppercase tracking-[0.14em]",
        dark ? "text-zinc-500" : "text-zinc-500 dark:text-zinc-500",
      )}
    >
      {children}
    </p>
  );
}

/** Section heading, at the one display size the site uses. Used by SectionHead. */
function Heading({
  children,
  dark,
  className,
}: {
  children: React.ReactNode;
  dark?: boolean;
  className?: string;
}) {
  return (
    <h2
      className={clsx(
        "text-[2rem] font-medium tracking-tight text-balance sm:text-4xl",
        dark ? "text-zinc-50" : "text-zinc-900 dark:text-zinc-50",
        className,
      )}
    >
      {children}
    </h2>
  );
}

/** Standfirst paragraph under a heading. Used by SectionHead. */
function Lead({
  children,
  dark,
  className,
}: {
  children: React.ReactNode;
  dark?: boolean;
  className?: string;
}) {
  return (
    <p
      className={clsx(
        "max-w-2xl text-[17px]/8 text-pretty",
        dark ? "text-zinc-400" : "text-zinc-600 dark:text-zinc-400",
        className,
      )}
    >
      {children}
    </p>
  );
}

type ButtonTone = "primary" | "ghost" | "ghostOnDark";

const BUTTON_TONES: Record<ButtonTone, string> = {
  primary: "bg-accent text-white hover:bg-blue-700 focus-visible:outline-accent",
  ghost:
    "text-zinc-700 hover:text-zinc-950 focus-visible:outline-accent dark:text-zinc-300 dark:hover:text-zinc-50",
  ghostOnDark: "text-zinc-300 hover:text-zinc-50 focus-visible:outline-zinc-100",
};

/**
 * A call to action. `primary` is the one solid button on the page — used
 * exactly once per view, for "Open the platform" — everything else is a quiet
 * text link with an arrow, so the page never shows two competing boxes side
 * by side.
 */
export function ButtonLink({
  href,
  tone = "primary",
  children,
  className,
}: {
  href: string;
  tone?: ButtonTone;
  children: React.ReactNode;
  className?: string;
}) {
  const isGhost = tone !== "primary";
  const classes = clsx(
    "inline-flex items-center gap-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
    isGhost
      ? "py-3"
      : "justify-center rounded-md px-5 py-3 font-semibold",
    BUTTON_TONES[tone],
    className,
  );
  return href.startsWith("/") ? (
    <Link href={href} className={classes}>
      {children}
    </Link>
  ) : (
    <a href={href} className={classes} rel="noopener noreferrer">
      {children}
    </a>
  );
}

/**
 * A link from the copy files. `external` entries get the usual rel hardening
 * plus an arrow, so a reader knows the click leaves the site before making it.
 */
export function CopyLink({ link, className }: { link: SiteLink; className?: string }) {
  const classes = clsx(
    "inline-flex items-center gap-1 text-zinc-700 underline-offset-4 transition-colors hover:text-accent hover:underline dark:text-zinc-300",
    className,
  );
  if (!link.external) {
    return (
      <Link href={link.href} className={classes}>
        {link.label}
      </Link>
    );
  }
  return (
    <a href={link.href} className={classes} target="_blank" rel="noopener noreferrer">
      {link.label}
      <ArrowUpRight className="size-3.5 shrink-0" aria-hidden="true" />
    </a>
  );
}

/** GitHub's mark. Inlined because lucide dropped brand glyphs; drawn in `currentColor`. */
export function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/**
 * The two-column header every band opens with: label and heading on the left,
 * the standfirst on the right — a masthead split, the way a serious editorial
 * page lays out a section rather than a stack of centred marketing copy.
 *
 * WHY TWO COLUMNS: at desktop width a single left-aligned column leaves the
 * right half of the page empty band after band, which reads as an unfinished
 * layout rather than as whitespace. Below `lg` it collapses to one column, in
 * reading order.
 */
export function SectionHead({
  eyebrow,
  title,
  body,
  dark,
}: {
  eyebrow: string;
  title: string;
  /** One paragraph, several, or none — a band whose heading stands alone. */
  body?: string | string[];
  dark?: boolean;
}) {
  const paragraphs = body === undefined ? [] : Array.isArray(body) ? body : [body];
  return (
    <div className="grid gap-x-12 gap-y-6 lg:grid-cols-12">
      <div className="lg:col-span-5">
        <Eyebrow dark={dark}>{eyebrow}</Eyebrow>
        <Heading dark={dark} className="mt-3">
          {title}
        </Heading>
      </div>
      {paragraphs.length > 0 && (
        <div className="space-y-5 lg:col-span-6 lg:col-start-7 lg:pt-1">
          {paragraphs.map((paragraph) => (
            <Lead key={paragraph} dark={dark}>
              {paragraph}
            </Lead>
          ))}
        </div>
      )}
    </div>
  );
}
