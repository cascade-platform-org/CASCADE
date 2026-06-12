# Issue tracker: GitHub

Issues and PRDs for this project live as GitHub Issues on **Cristian-Curaba/CASCADE-app**.
Use the `gh` CLI for all operations.

**Repo layout:** `CASCADE-app/` and `CASCADE-backend/` are separate git repositories
inside the `CASCADE-v2/` workspace. Always run `gh` / `git` from inside `CASCADE-app/`
(or pass `-R Cristian-Curaba/CASCADE-app` explicitly) — the workspace root is not a repo.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Run all `gh` commands from within `CASCADE-app/` (where the remote is configured) or pass `-R Cristian-Curaba/CASCADE-app` explicitly.

## When a skill says "publish to the issue tracker"

Create a GitHub issue on `Cristian-Curaba/CASCADE-app`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments` from inside `CASCADE-app/`.
