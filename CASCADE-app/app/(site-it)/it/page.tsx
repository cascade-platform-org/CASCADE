/**
 * /it — la landing page in italiano. Twin of `app/(site)/page.tsx`, rendering
 * the same component with the Italian copy.
 */

import { Landing } from "@/components/site/landing";
import { it, CONTACT_EMAIL, REPO_URL } from "@/lib/site-copy";
import { structuredData } from "@/lib/site-metadata";

export default function HomePageIt() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: structuredData(it, REPO_URL, CONTACT_EMAIL) }}
      />
      <Landing copy={it} />
    </>
  );
}
