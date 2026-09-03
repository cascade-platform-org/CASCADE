# samples/

Source data for the example projects offered in the "new project" wizard.

- **`public/`** — git-tracked, ships in the public repo. Source of truth for
  the manifest (`public/manifest.json`) and every sample the app serves.
  `scripts/sync-samples.mjs` copies this directory into `public/samples/`
  (the Next.js-served, gitignored build artifact) on every `dev`/`build` —
  edit files here, never in `public/samples/` directly, or your edit will be
  overwritten by the next sync.
- **`private/`** — gitignored, never leaves this machine. Working scenarios
  not cleared for the public repo: named after real people, tied to an
  unpublished paper, or otherwise not ready to promote. Never referenced by
  `manifest.json` or fetched by the app.
- **`generate_scenarios.py`** — tooling, applies to either directory.

To publish a sample: move its JSON from `private/` to `public/`, add an entry
to `public/manifest.json`, and run `npm run sync:samples` (or just `npm run
dev`/`build`, which do it automatically).
