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
| `/orchestrator` | Central lease model across PM and promoted build subtrees |

## bundle CLI

`bun run bundle -- <command> [--kind <name>] <project-path>` manages
manifest-driven bundles across projects. It works on any bundle that ships
a `manifest.yaml` describing where each canonical file installs in a target.
Currently registered:

- `--kind pm-loop` — [maxthelion/pm-loop](https://github.com/maxthelion/pm-loop)
- `--kind shoe-makers` — `~/dev/shoe-makers/bundle/` inside [maxthelion/shoe-makers](https://github.com/maxthelion/shoe-makers)

Add or override the registry under `bundles:` in `meta/config.yaml`. You
can also point at a bundle directly with `--bundle <path>` (overrides
`--kind`).

| Command | What it does |
| --- | --- |
| `install` | Copy the canonical files into a fresh project. Writes `.<bundle-name>.lock` recording bundle version + source SHA + per-file hashes. Refuses to overwrite pre-existing files unless `--force`. |
| `status` | Compare the bundle, the lockfile, and the project's current files. Reports per file: `in sync`, `UPDATE AVAILABLE`, `LOCAL EDIT`, `CONFLICT`, `MISSING`. Exit code != 0 if any drift. |
| `update` | Apply bundle changes to files the project hasn't modified (`UPDATE AVAILABLE`). Skips `LOCAL EDIT`, refuses on `CONFLICT` unless `--force`. Bumps the lockfile only for files actually applied. |
| `diff`   | Print unified diff between target and bundle for any non-in-sync file (optional path filter). |

Drift legend:
- `in sync` — target == lock == bundle.
- `UPDATE AVAILABLE` — bundle changed since install; target untouched. Safe to update.
- `LOCAL EDIT` — target changed; bundle unchanged. Project owns this file now; pass `--force` for an intentional reset.
- `CONFLICT` — both target and bundle have changed. Needs manual merge: use `bundle diff <project>`, decide, then `update --force` once you've reconciled.
- `MISSING` — target file absent. `update` will create it; `install` should run first.

The `bun run pm-loop ...` script is kept as an alias for back-compat; it
just calls the same CLI with the default `--kind pm-loop`.

## orchestrator CLI

`bun run orchestrator` renders the central lease model across registered
projects. It discovers PM-loop work, promoted build worktrees, ready signals,
and human-attention blockers, then grants a parallel-safe batch of leases using
cwd, branch, roadmap-item, and shared-resource conflict keys.

Useful modes:

- `bun run orchestrator` — human-readable lease report.
- `bun run orchestrator -- --json` — machine-readable model for a heartbeat.
- `bun run orchestrator -- --refresh` — refresh child selectors before reading.

The matching dashboard page is `/orchestrator`.

## Orchestrator and client

meta is two things at once:

- **Orchestrator.** It ships the `bundle` CLI that installs canonical
  workflow bundles into other projects, manages drift, and pulls
  updates safely. Other repos depend on meta to install bundles.
- **Client.** It is itself a target for those same bundles. The wiki
  skills under `.claude/skills/octowiki-*` and the canonical
  `wiki/pages/category-taxonomy.md` were installed via
  `bundle install --kind octowiki` against this repo. They are tracked
  in `.octowiki.lock`. If the canonical octowiki bundle changes upstream,
  `bundle status --kind octowiki .` will report it here, and
  `bundle update --kind octowiki .` will pull it in.

This dual role keeps the contract honest: any change to a bundle's shape
that breaks consumers will break meta first, since meta is also a consumer.

Currently installed bundles in this repo:

| Kind | Lockfile | Provides |
| --- | --- | --- |
| `octowiki` | `.octowiki.lock` | OctoWiki skills + canonical category taxonomy |
| `pm-loop` | `.pm-loop.lock` | Deterministic roadmap selector, `pm-next-action` skill, `pm-assistant` agent role, `capture-clarification` / `capture-feedback` / `commit-roadmap-action` / `promote-ready-item-to-worktree` helpers |

To activate the pm-loop in this repo, create `docs/roadmap/<feature-slug>/README.md`
with the standard frontmatter (`id`, `title`, `status: inventory`, ...) and run
`scripts/roadmap/next-roadmap-actions.sh` — see `docs/working-through-a-roadmap.md`.

Available but not installed:

- `shoe-makers` — install once meta has tests and invariants worth running an overnight code-health loop against.

## Status

Early. Built to support an in-sequence PM workflow that already exists.
Other plugins (octoclean health, octowiki rendering, schedule-tracker)
are stubs or future work.
