# Contributing

Issues and pull requests are welcome.

**Reporting a bug or requesting a feature.** Open a
[GitHub Issue](https://github.com/cascade-platform-org/CASCADE/issues). For a bug,
say what you did, what you expected, and what happened instead — a failing input is
worth more than a description of it. For a feature, describe the problem you're
trying to solve rather than the solution you have in mind; the architecture often
already has a way in, and it may not be the obvious one.

**Proposing a change.** Fork, branch off `main`, and open a pull request. Before you
start on anything substantial, open an issue first — this codebase carries a few
deliberate constraints (the engine boundary in [CLAUDE.md](CLAUDE.md) §7, the
schema-first rule in §6) that are easy to trip over and awkward to unpick after the
fact.

- Sign off your commits: `git commit -s`. This is a
  [Developer Certificate of Origin](https://developercertificate.org/) assertion —
  it records that you wrote the contribution and can license it under AGPL-3.0.
- CI must pass: backend lint + tests, frontend type-check + unit tests + build, docs links, and
  Docker/compose validation. Run `CASCADE-backend/scripts/audit.sh` locally to catch
  most of it before pushing.
- Follow the vocabulary in [CONTEXT.md](CONTEXT.md). One concept, one term.

**Review.** Pull requests are reviewed and merged by the maintainer — there is no
auto-merge, so expect a conversation rather than a silent accept or reject.

## Licence

Contributions are accepted under the project's licence,
**AGPL-3.0-or-later** — see [LICENSE](LICENSE) and [NOTICE](NOTICE). The DCO
sign-off above is what lets the authors keep the ability to relicense later
(ADR-0009's engine privatization depends on it).
