# meta

A federated dashboard for the projects under `~/dev`. Each project keeps
its own artefacts, scripts, and conventions; this hub reads them in
place and surfaces them through one local web view.

## Goals

- **Central command, distributed truth.** Reading and triaging happens
  here. The artefacts live in the projects themselves and are owned by
  whatever workflow that project already runs. Nothing is copied; the
  hub is disposable.
- **Projects expose data, the hub renders.** A project ships structured
  files (frontmatter on roadmap items, feature directories, skills,
  agents, etc.). The hub turns that into HTML views. The repo never has
  to learn HTML for a dashboard to exist.
- **Annotations write back into the repo.** PM-style actions (capture
  clarification, capture feedback) shell out to scripts the project
  already owns. The hub provides the UI; the project owns the format.
  In-repo agents pick those notes up on their next pass.
- **Convention with optional escape hatch.** Plugins auto-detect by
  filesystem layout (`docs/roadmap/`, `.claude/skills/`, `wiki/pages/`,
  `.git/`). A `.meta.yaml` manifest in a project is only needed when
  conventions don't fit.
- **Project Management workflow first-class.** The PM flow is treated
  as a feature directory accumulating artefacts (notes, user stories,
  existing-state, prototypes, ux-review, architecture, spec, plan,
  handoff) plus a feedback queue and the conversation behind them. The
  hub renders that inventory and provides scoped review pages where you
  can step through prototypes in iframes and capture feedback alongside.

## What it isn't

- Not a project ledger or build system. It does not own state.
- Not a content store. Annotations and artefacts live in the project.
- Not a remote service. Runs locally on your machine.

## Run

```sh
bun install
bun run src/server.ts
```

Then open `http://localhost:7777`.

## Configuration

Projects to surface are listed in `config.yaml`:

```yaml
port: 7777
dev-root: /Users/maxwilliams/dev
projects:
  - name: in-sequence
    path: /Users/maxwilliams/dev/in-sequence
    status: active
```

Per-project overrides go in an optional `.meta.yaml` inside the project:

```yaml
name: in-sequence
description: Music sequencer
status: active
plugins: [roadmap, skills, agents, wiki, git]   # if omitted, auto-detect
roadmap: { dir: docs/roadmap }
actions:
  capture-feedback: scripts/roadmap/capture-feedback.sh
  capture-clarification: scripts/roadmap/capture-clarification.sh
```

## Plugins

Each plugin is `(project) → { detect, summary?, render, actions?, handleAction? }`.

- `roadmap` — reads `docs/roadmap/<feature>/` directories, renders the
  PM dashboard, per-feature artefact inventory, dedicated
  review-prototypes pages (tabs + iframe + scoped feedback form), and
  capture-clarification / capture-feedback actions wired to the
  project's own scripts.
- `skills` — lists `.claude/skills/*/SKILL.md` and `.agents/skills/*`.
- `agents` — lists `.claude/agents/*.md` and `.agents/agents/*`.
- `wiki` — lists markdown files under `wiki/pages/`, `wiki/`, or
  `docs/wiki/`.
- `git` — recent commits.

Plugins read project files directly. They never write to a central
store. Actions write into the project repo via project-owned scripts.

## Routes

| Path | Purpose |
| --- | --- |
| `/` | Project index |
| `/p/<slug>` | Project dashboard (all plugin sections) |
| `/p/<slug>/roadmap/<feature>` | Feature page: artefact inventory, feedback queue, scoped form |
| `/p/<slug>/roadmap/<feature>/review-prototypes/<file>` | Tabbed prototype review with feedback capture |
| `/p/<slug>/files/<rel-path>` | Serves project files (used by iframes) |
| `/p/<slug>/action/<id>` | POST: shells out to project script |

## Status

Early. Built to support an in-sequence PM workflow that already exists.
Other plugins (octoclean health, octowiki rendering, schedule-tracker)
are stubs or future work.
