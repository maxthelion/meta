---
name: octowiki-batch-import
description: Use when importing or consolidating documentation from a repo into the wiki. Triggered by /octowiki:batch-import. Use when the user wants to bootstrap, import, or batch-create wiki pages from existing markdown files.
---

# Batch Import

Import and consolidate documentation from a repository into structured wiki pages using a map-reduce pipeline.

## Usage

```
/octowiki:batch-import <repo-path> [--dry-run] [--force]
```

- `<repo-path>` — path to the repo to import from (defaults to cwd)
- `--dry-run` — stop after preview, don't apply to wiki
- `--force` — proceed even if >200 files found

## Process

### Step 1: Discover

Run the discovery script to find all markdown files and create a manifest:

```bash
bunx octowiki import discover <repo-path>
```

This creates `/tmp/octowiki-import-XXXX/manifest.json` with all discovered files, their git dates, and content. Read the manifest to get the file list and temp directory path.

If the manifest has >200 files and `--force` was not passed, stop and ask the user to confirm.

### Step 2: Index

Ensure the wiki's search index is current (skip if qmd is not available):

```bash
qmd update --collection wiki/.index/qmd
qmd embed --collection wiki/.index/qmd
```

### Step 3: Map (Haiku subagents)

For each file in the manifest, dispatch a Haiku subagent (parallel, batches of 10).

Before dispatching, for each file:
1. Read `wiki/pages/category-taxonomy.md` — include the **full content** including "What belongs here" and "Pages should contain" sections for every category. Do not abbreviate or summarise the taxonomy — the subagent needs the full descriptions to make good category decisions.
2. List existing wiki page slugs: `ls wiki/pages/`
3. Run a qmd search for the file's title/first heading to check for existing coverage:
   `qmd search "<title>" --json --collection wiki/.index/qmd`

**Map subagent prompt:**

> You are extracting structured topic summaries from a documentation file for a wiki.
>
> **File:** {relativePath} (last modified: {lastModified})
>
> **File content:**
> ```
> {content}
> ```
>
> **Category taxonomy (full — read the "Pages should contain" guidelines to choose the right category):**
> ```
> {category-taxonomy.md content — FULL, not abbreviated}
> ```
>
> **Existing wiki pages:** {comma-separated list of slugs}
>
> **Search results for existing coverage:**
> ```
> {qmd search results}
> ```
>
> Extract wiki-worthy topics from this file. For each topic, provide:
> - `topic`: short name
> - `suggestedSlug`: kebab-case, max 60 chars
> - `category`: one category from the taxonomy (match against descriptions)
> - `summary`: one sentence
> - `content`: the extracted content, lightly restructured for a wiki reader
> - `tags`: 2-5 relevant tags
> - `confidence`: 0.0-1.0 (how wiki-worthy is this topic?)
>
> Also check for overlaps with existing wiki pages. If a topic substantially overlaps an existing page, flag it in `existingOverlaps` with recommendation `merge_into_existing`.
>
> Skip boilerplate: changelogs, license blocks, badges, contribution guidelines, empty sections. Note what you skipped in the `skipped` field.
>
> A single file may produce multiple topics (e.g. a long README covering several subjects). Only extract topics that would make meaningful wiki pages.
>
> Respond with JSON only:
> ```json
> {
>   "file": "<relativePath>",
>   "topics": [...],
>   "existingOverlaps": [...],
>   "skipped": "<what was skipped and why>"
> }
> ```

Use model override `haiku` for these subagents.

**JSON parsing:** The subagent response may be wrapped in markdown code fences. Strip leading/trailing whitespace, remove ` ```json ` and ` ``` ` fences if present, then `JSON.parse()`. If parsing fails or required fields (`file`, `topics`) are missing, that's a retryable failure. Retry up to 3 times. On permanent failure (3 consecutive parse/call failures), record the file in skipped with the error.

Write each result to `/tmp/.../map/<filename>.json`.

### Step 4: Group

Run the grouping command. This reads map outputs from `<staging-dir>/map/*.json`, reads existing wiki pages, groups them, and writes `groups.json` to the staging dir:

```bash
bunx octowiki import group /tmp/octowiki-import-XXXX
```

### Step 5: Reduce (Sonnet subagents)

For each group, dispatch a Sonnet subagent. Two prompt variants:

**New page reduce prompt:**

> You are writing a wiki page from documentation extracts. The page must be a well-structured, standalone document that a reader can understand without consulting the source material.
>
> **Target slug:** {slug}
> **Target category:** {category}
> **Available tags:** {allTags}
>
> **Category guidelines (from taxonomy):**
> ```
> {guidelines for this category from category-taxonomy.md}
> ```
>
> **Content guidelines:**
> ```
> {content-guidelines.md content}
> ```
>
> **Extracts (ordered by recency, most recent first):**
> {for each extract:}
> --- Source: {source} (date: {date}) ---
> {content}
>
> **Related existing wiki pages (for cross-referencing):**
> {qmd search results}
>
> Write a complete wiki page from these extracts. Rules:
> - **Structure the page properly** — use an Overview section, then topic-specific sections with headings, lists, tables, and code blocks as appropriate. The page should read as a coherent document, not a collection of notes.
> - Follow the category's "pages should contain" guidelines
> - Prefer content from more recent sources when there's conflict
> - Use `[[wikilinks]]` to cross-reference related pages — don't duplicate content
> - Select 2-5 tags from the available tags
> - Write a one-sentence summary
> - Be concise — distill, don't copy — but do not be terse. The page should contain enough detail that a reader can understand the topic without needing to read the source material.
>
> Respond with JSON only:
> ```json
> {
>   "slug": "<slug>",
>   "title": "<title>",
>   "category": "<category>",
>   "tags": [...],
>   "summary": "<one sentence>",
>   "content": "<markdown content>"
> }
> ```

**Merge reduce prompt:**

> You are incorporating new information into an existing wiki page.
>
> **Existing page ({slug}):**
> ```
> {existing page raw content including frontmatter}
> ```
>
> **New extracts to incorporate:**
> {for each extract:}
> --- Source: {source} (date: {date}) ---
> {content}
>
> **Content guidelines:**
> ```
> {content-guidelines.md content}
> ```
>
> Weave the new information into the existing page. Rules:
> - Preserve the existing page's structure and voice
> - Add new information where it fits naturally
> - If new info conflicts with existing, prefer more recent (check dates)
> - Don't duplicate — if the page already says it, don't add it again
> - Use `[[wikilinks]]` for cross-references
> - Update tags and summary if warranted
>
> Respond with JSON only:
> ```json
> {
>   "slug": "<slug>",
>   "action": "update",
>   "title": "<title>",
>   "category": "<category>",
>   "tags": [...],
>   "summary": "<summary>",
>   "content": "<full updated markdown content>",
>   "changelog": "<one line describing what changed>"
> }
> ```

Use model override `sonnet` for reduce subagents. On failure, retry up to 3 times. On permanent failure, add to skipped.

**IMPORTANT: Every group must be dispatched to a Sonnet subagent — no exceptions, no shortcuts.** Do not auto-format single-extract groups by passing content through without Sonnet. A raw extract is not a wiki page. Sonnet's job is to restructure content into a well-written, standalone document with proper headings, sections, cross-references, and enough context that a reader can understand the topic. This applies equally whether the group has one extract or ten.

Write results to `/tmp/.../reduce/<slug>.json`.

### Step 6: Apply

Run the apply script to construct pages from reduce outputs and stage them:

```bash
bunx octowiki import apply /tmp/octowiki-import-XXXX
```

The script handles:
- Reading all reduce output JSON files
- Constructing frontmatter from JSON fields (title, category, tags, summary) — the `content` field from reduce outputs may contain duplicate frontmatter, which the script strips
- YAML-safe quoting of values containing special characters (colons, etc.)
- Slug collision detection (appends `-2`, `-3` etc.)
- Backing up `wiki/pages/` to `wiki/pages-pre-import/`
- Creating a new `wiki/pages/` with both existing and new/merged pages
- Printing a summary of what was applied

If `--dry-run` was passed, skip this step and tell the user the reduce outputs persist in `/tmp/` for browsing.

**Reverting:** If the user wants to undo:
```bash
bunx octowiki import apply /tmp/octowiki-import-XXXX --revert
```

**Committing:** If the user is satisfied, clean up:
```bash
rm -rf wiki/pages-pre-import
```
