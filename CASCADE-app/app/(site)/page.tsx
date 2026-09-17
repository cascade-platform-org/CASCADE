/**
 * / — the English landing page.
 *
 * A server component, so its prose lands in the HTML `next build` writes. That
 * is what makes the page indexable: a crawler reads the argument without
 * running any JavaScript.
 */

import { Landing } from "@/components/site/landing";
import { en, CONTACT_EMAIL, REPO_URL } from "@/lib/site-copy";
import { structuredData } from "@/lib/site-metadata";

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        // JSON-LD is data inside a script tag, so React must leave it
        // unescaped. Built from constants in `lib/` — no input reaches it.
        dangerouslySetInnerHTML={{ __html: structuredData(en, REPO_URL, CONTACT_EMAIL) }}
      />
      <Landing copy={en} />
    </>
  );
}
