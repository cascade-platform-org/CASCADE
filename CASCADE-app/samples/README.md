# samples/

Source data for the example projects offered in the "new project" wizard.

- **`public/`** — git-tracked, ships in the public repo. Source of truth for
  the manifest (`public/manifest.json`) and every sample the app serves.
  `scripts/sync-samples.mjs` copies this directory into `public/samples/`
  (the Next.js-served, gitignored build artifact) on every `dev`/`build` —
  edit files here, never in `public/samples/` directly, or your edit will be
  overwritten by the next sync.

  **The manifest is a shorter list than the directory.** The wizard offers
  exactly three networks — Palmanova Complete, Office with Heat, and the IJDRR
  example. The other tracked files are deliberately not offered, and must stay:

  | File(s) | Why it stays |
  |---|---|
  | `Palmanova_Complete_{electric_priority,water_improvement}.json` | The post-intervention models `docs/papers.md` cites for IJDRR §4.3 |
  | `rule-*.json`, `flow-power-scarcity.json`, `dependency-guard.json`, `backup-defer.json` | Engine regression fixtures, loaded by name in `CASCADE-backend/test/test_engine_samples.py` |
  | `Updated_Palmanova_New.json` | `BASE_JSON` for `generate_scenarios.py` |
  | `base_georef.json` | Georeferencing reference model |

  Adding a file here does not surface it in the app; only a manifest entry does.
  Nothing loads samples *through* the manifest except the wizard, so trimming it
  cannot break a test.
- **`private/`** — gitignored, never leaves this machine. Working scenarios
  not cleared for the public repo: named after real people, tied to an
  unpublished paper, or otherwise not ready to promote. Never referenced by
  `manifest.json` or fetched by the app.
- **`generate_scenarios.py`** — tooling, applies to either directory.

To publish a sample: move its JSON from `private/` to `public/`, add an entry
to `public/manifest.json`, and run `npm run sync:samples` (or just `npm run
dev`/`build`, which do it automatically).
