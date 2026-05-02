# Central Orchestrator

The orchestrator is the top-level behaviour-tree model for running many
project subtrees without losing determinism.

It does not replace `pm-loop` or `build-loop`. It sits above them:

```text
central orchestrator
  -> PM subtree for roadmap artifacts
  -> build subtree for each promoted worktree
  -> human attention / ready-for-user signals
```

## Principle

The central selector grants **leases**, not vague permission. A lease names:

- the target project and cwd;
- the subtree (`pm-loop`, `build-loop`, or bootstrap);
- the exact next action;
- exclusive conflict keys such as cwd, branch, and roadmap item;
- shared limits such as `pm`, `build`, and `xcodebuild`.

This means the system can run in parallel where isolation is real, while
refusing combinations that would trample the same files, branch, or machine
resource.

## Current Commands

Inspect the model:

```sh
bun run orchestrator
```

Refresh child selectors first, then inspect:

```sh
bun run orchestrator -- --refresh
```

Emit machine-readable JSON:

```sh
bun run orchestrator -- --json
```

The dashboard view is at:

```text
http://localhost:7777/orchestrator
```

## Lease Statuses

- `granted`: safe to run in parallel this tick.
- `blocked`: otherwise runnable, but blocked by a cwd/branch/item conflict or
  shared-resource limit.
- `attention`: needs the user before automation should proceed.
- `ready`: a build subtree has produced `ready-for-user.md`.

## Automation Shape

A heartbeat should eventually do only this:

1. Run the central selector.
2. For each `granted` lease, start one runner in that lease's cwd.
3. The runner executes exactly one subtree action and stops.
4. The next heartbeat re-evaluates from disk.

The runner remains simple because the lease is already scoped. It should not
choose work; it should obey the lease.
