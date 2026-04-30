---
name: octowiki-invariants
description: Use when extracting and comparing invariants between wiki documentation and code. Triggered by /octowiki:invariants. Use when the user wants to check implementation coverage, find gaps between spec and code, or generate an invariants report.
---

# Invariants

Extract falsifiable statements from wiki documentation and code independently, then compare them to surface implementation gaps.

## Usage

```
/octowiki:invariants [--stage 1|2|3] [--group <group-name>]
```

- Default: runs all three stages
- `--stage N`: re-run just one stage
- `--group <name>`: scope to a single invariant group

## Process

### Step 1: Spec Extraction

Prepare batches of wiki pages grouped by category:

```bash
bunx octowiki invariants --stage 1
```

This creates batch JSON files in the staging directory. For each batch, dispatch a Sonnet subagent.

**Spec extraction prompt:**

> You are extracting invariants from wiki documentation. An invariant is a falsifiable statement about what the system does or guarantees.
>
> **Category:** {category}
>
> **Pages:**
> {for each page:}
> --- Page: {slug} ---
> {content}
>
> Extract invariants from these pages. For each invariant:
> - `id`: dotted path starting with a group name (e.g. "agent-pipeline.watcher.debounce-timing"). The group name should reflect the system area.
> - `parent`: the parent invariant's id, or null for top-level invariants
> - `description`: a single falsifiable statement. Atomic — one claim per invariant. Specific enough to check against code.
> - `kind`: "behavioural" (what the system does, language-agnostic) or "architectural" (deliberate structural decision)
> - `verificationMethod`: one of "unit-test", "integration-test", "visual-qa", "manual-check", "static-analysis"
> - `sources`: array of wiki page slugs this invariant was derived from
>
> Organise hierarchically — broad invariants at the top, specific ones as children.
>
> Do NOT extract:
> - Tautologies
> - Implementation details (unless they are deliberate architectural decisions)
> - Unmeasurable qualities
> - Duplicate invariants across pages — if two pages mention the same thing, extract it once
>
> Respond with JSON only:
> ```json
> { "invariants": [...] }
> ```

Use model override `sonnet` for these subagents.

**JSON parsing:** Strip markdown code fences if present. Retry up to 3 times on parse failure.

After all batches complete, run a **deduplication pass** — dispatch a single Sonnet subagent with all extracted invariants to merge duplicates (same description from different categories), combining their `sources` arrays. At larger scale this may need batching.

Write the deduplicated result to `wiki/invariants/tree.json`.

### Step 2: Evidence Extraction

Prepare evidence extraction inputs:

```bash
bunx octowiki invariants --stage 2
```

This reads `tree.json` and creates input files per invariant group, each containing the invariant descriptions plus the relevant source and test files. File scoping uses a directory mapping table in the script plus grep for key terms.

For each group, dispatch a Sonnet subagent.

**Evidence extraction prompt:**

> You are checking source code for evidence of specified invariants. You have NOT seen the wiki documentation — only the invariant descriptions and the code.
>
> **Group:** {group}
>
> **Invariants to check:**
> {for each invariant:}
> - `{id}`: {description}
>
> **Source files:**
> {for each file:}
> --- {path} ---
> ```typescript
> {content}
> ```
>
> **Test files:**
> {for each file:}
> --- {path} ---
> ```typescript
> {content}
> ```
>
> For each invariant, determine:
> 1. Is there code that implements this invariant? (look for functions, routes, config, logic that would make the statement true)
> 2. Is there a test that verifies this invariant? (look for test assertions that would fail if the invariant were violated)
>
> Also look for behaviours in the code that are NOT covered by any of the listed invariants. These are "unspecified" invariants — things the code does that the documentation doesn't mention.
>
> Respond with JSON only:
> ```json
> {
>   "evidence": [
>     {
>       "invariantId": "<id>",
>       "implemented": true/false,
>       "tested": true/false,
>       "codeLocations": ["path/to/file.ts"],
>       "testLocations": ["path/to/test.ts"]
>     }
>   ],
>   "unspecified": [
>     {
>       "description": "<what the code does that isn't in the spec>",
>       "codeLocations": ["path/to/file.ts"],
>       "testLocations": ["path/to/test.ts"]
>     }
>   ]
> }
> ```

Use model override `sonnet`. Retry up to 3 times on failure.

Merge all group results into `wiki/invariants/evidence.json`.

### Step 3: Comparison

This stage is deterministic — no LLM call needed. Run the compare and assemble command:

```bash
bunx octowiki invariants --stage 3
```

This merges tree and evidence into resolved invariants with statuses and renders wiki pages to `wiki/invariants/`.

### Step 4: Report

Output a summary:

```
Invariants report:
  Total spec invariants: N
  Implemented + tested:  N
  Implemented, untested: N
  Specified only:        N
  Unspecified (in code):  N

  Groups:
    group-name — coverage%
    ...

  Wiki pages written to wiki/invariants/
```
