# Issue tracker: GitHub

Issues and PRDs for this project live as GitHub Issues on **cascade-platform-org/CASCADE**.
Use the `gh` CLI for all operations.

**Repo layout:** one monorepo (ADR-0009) rooted at `CASCADE-v2/`; `CASCADE-app/` and
`CASCADE-backend/` are plain subdirectories, not separate repos. Run `gh` / `git` from
the workspace root; `-R cascade-platform-org/CASCADE` is only needed if your cwd is
outside the workspace entirely.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Run all `gh` commands from the workspace root, where the remote is configured.

## When a skill says "publish to the issue tracker"

Create a GitHub issue on `cascade-platform-org/CASCADE`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments` from the workspace root.
