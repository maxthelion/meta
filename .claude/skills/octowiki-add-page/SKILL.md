---
name: octowiki-add-page
description: Use when adding a new page to the OctoWiki wiki, or when the user asks to create/add a wiki page. Triggered by /octowiki:add-page.
---

# Add Wiki Page

Add a new page to the OctoWiki wiki at `wiki/pages/`.

## Usage

```
/octowiki:add-page <prompt>
```

The prompt becomes the page content. You fill in the structure.

## Steps

1. **Read the category taxonomy** at `wiki/pages/category-taxonomy.md` to understand what each category expects.

2. **Read existing pages** to avoid slug collisions:
   ```bash
   ls wiki/pages/
   ```

3. **Derive from the prompt:**
   - **slug**: kebab-case, max 60 chars, descriptive (e.g. `api-rate-limiting`)
   - **title**: Human-readable version of the topic
   - **category**: Pick the single best-fit from the taxonomy. Match the user's content against each category's description and "pages should contain" guidelines.
   - **tags**: 2-5 relevant tags
   - **summary**: One sentence describing the page

4. **Write the page** to `wiki/pages/<slug>.md`:

   ```markdown
   ---
   title: "<title>"
   category: "<category>"
   tags: [tag1, tag2, tag3]
   summary: "<one sentence summary>"
   last-modified-by: user
   ---

   <structured content>
   ```

5. **Structure the content** following the category's "pages should contain" guidelines from the taxonomy. Don't just dump the prompt verbatim — organise with headings, lists, and sections. Add `[[wikilinks]]` to related pages where relevant. The user's raw notes should be preserved but integrated into the structure.

6. **Confirm**: Tell the user the page was created, its category, and its path.

## Rules

- Always read `wiki/pages/category-taxonomy.md` before choosing a category
- Always set `last-modified-by: user`
- Never overwrite an existing page — if the slug exists, append a number
- Keep slugs short and descriptive
- Cross-reference other wiki pages with `[[slug]]` syntax where relevant
