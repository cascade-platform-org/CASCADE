/**
 * Every off-site URL the website points at, in one place.
 *
 * The docs are not served by the site — they live in the repository — so a
 * "User manual" link has to resolve to a GitHub blob URL. Keeping the repo root
 * as one constant means a move of the repository is a one-line change rather
 * than a hunt through two copy files.
 */

export const REPO_URL = "https://github.com/cascade-platform-org/CASCADE";

/** A file in the repository, on the default branch. */
const repoFile = (path: string) => `${REPO_URL}/blob/main/${path}`;

export const LINKS = {
  repo: REPO_URL,
  userManual: repoFile("docs/project/user-manual.md"),
  papers: repoFile("docs/papers.md"),
  architecture: repoFile("docs/project/architecture.md"),
  glossary: repoFile("CONTEXT.md"),
  licence: repoFile("LICENSE"),
  privacy: repoFile("docs/project/privacy-and-data-protection.md"),
  citation: repoFile("CITATION.cff"),
  benchmarks: repoFile("experiments/aqueducts/benchmark-protocol.md"),
} as const;

/**
 * Where enquiries go. Already the project's public contact address — it is the
 * author e-mail in CITATION.cff, which GitHub renders on the repository page.
 * Change it here and both locales follow.
 */
export const CONTACT_EMAIL = "cristian.curaba@uniud.it";

/** The editor. A plain path, because the site and the app share an origin. */
export const APP_PATH = "/app";

/**
 * `mailto:` with the subject filled in, so an enquiry arrives already sorted
 * into the kind of conversation it is.
 */
export function mailto(subject: string): string {
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}
