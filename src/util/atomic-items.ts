/**
 * Parse semi-structured PM artefacts into atomic items so the triage queue
 * can show "one thing at a time" instead of asking the user to mentally split
 * a single file into N decisions.
 *
 * concerns.md format:
 *   ## Concerns
 *   1. **Title.** body across one or more indented lines
 *   2. **Title.** body
 *
 * open-questions.md format:
 *   ## Questions For The User    (case-insensitive)
 *   ### 1. Title
 *   body until next ### or ## or ---
 *
 * The parsers are conservative: when they can't find the expected structure,
 * they return a single synthetic item containing the full body so the user
 * still gets the file rendered, just without per-item granularity.
 */

import matter from "gray-matter";

export interface AtomicItem {
  id: string; // stable identifier within the file ("1", "2", or "all")
  title: string;
  body: string; // markdown source of just this item, ready for renderMarkdown
}

function stripFrontmatter(source: string): string {
  return matter(source).content.trimStart();
}

export function parseConcerns(source: string): AtomicItem[] {
  const text = stripFrontmatter(source);
  const headingIdx = text.search(/^##\s+Concerns\b/im);
  const sectionStart = headingIdx === -1 ? 0 : headingIdx + text.slice(headingIdx).indexOf("\n") + 1;
  const remaining = text.slice(sectionStart);
  // Cut at the next ## heading so "Suggested Resolution Path" or similar
  // doesn't leak into the last concern.
  const nextHeadingMatch = remaining.match(/^##\s+\S/m);
  const sectionBody =
    nextHeadingMatch && nextHeadingMatch.index !== undefined
      ? remaining.slice(0, nextHeadingMatch.index)
      : remaining;

  // Split on numbered list items at the start of a line.
  const splits: { id: string; raw: string }[] = [];
  const re = /^(\d+)\.\s+/gm;
  let lastEnd = -1;
  let lastId = "";
  let match: RegExpExecArray | null;
  const positions: { id: string; start: number }[] = [];
  while ((match = re.exec(sectionBody))) {
    positions.push({ id: match[1]!, start: match.index });
  }
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i]!.start;
    const end = i + 1 < positions.length ? positions[i + 1]!.start : sectionBody.length;
    splits.push({ id: positions[i]!.id, raw: sectionBody.slice(start, end).trim() });
  }

  if (splits.length === 0) {
    if (text.trim().length === 0) return [];
    return [{ id: "all", title: "Concerns", body: text }];
  }

  return splits.map(({ id, raw }) => {
    const titleMatch = raw.match(/^\d+\.\s+\*\*(.+?)\*\*/);
    const title = titleMatch ? titleMatch[1]!.replace(/\.+$/, "") : `Concern ${id}`;
    // Re-emit the body without the leading `N.` so the markdown renderer
    // shows the bold title naturally. Dedent the indented continuation lines.
    const dedented = raw
      .replace(/^\d+\.\s+/, "")
      .split("\n")
      .map((line) => line.replace(/^ {3}/, ""))
      .join("\n");
    return { id, title, body: dedented };
  });
}

export function parseOpenQuestions(source: string): AtomicItem[] {
  const text = stripFrontmatter(source);
  // Find a section like "## Questions For The User" (case-insensitive,
  // tolerates "for the user" / "for the user").
  const headingMatch = text.match(/^##\s+Questions\s+[Ff]or\s+[Tt]he\s+[Uu]ser\b.*$/m);
  if (!headingMatch || headingMatch.index === undefined) {
    if (text.trim().length === 0) return [];
    // Fall back: try a simpler "## Questions" heading or just return the body.
    const simple = text.match(/^##\s+Questions\b.*$/m);
    if (!simple || simple.index === undefined) {
      return [{ id: "all", title: "Open Questions", body: text }];
    }
  }
  const headingStart = (headingMatch ?? text.match(/^##\s+Questions\b.*$/m))!.index!;
  const afterHeading = text.indexOf("\n", headingStart) + 1;
  const remaining = text.slice(afterHeading);
  // Cut at the next ## heading (e.g., "Resolved questions").
  const nextHeading = remaining.match(/^##\s+\S/m);
  const sectionBody =
    nextHeading && nextHeading.index !== undefined ? remaining.slice(0, nextHeading.index) : remaining;

  // Split on ### headings.
  const positions: { id: string; titleLine: string; start: number }[] = [];
  const re = /^###\s+(\d+)\.\s+(.*)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sectionBody))) {
    positions.push({ id: m[1]!, titleLine: m[2]!.trim(), start: m.index });
  }

  if (positions.length === 0) {
    return [{ id: "all", title: "Open Questions", body: sectionBody }];
  }

  const items: AtomicItem[] = [];
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i]!.start;
    const end = i + 1 < positions.length ? positions[i + 1]!.start : sectionBody.length;
    let body = sectionBody.slice(start, end).trim();
    // Strip horizontal-rule separators that often follow each question.
    body = body.replace(/\n---\s*$/, "").trim();
    items.push({ id: positions[i]!.id, title: positions[i]!.titleLine, body });
  }
  return items;
}
