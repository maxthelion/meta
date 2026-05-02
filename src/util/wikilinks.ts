/**
 * Wikilink syntax: `[[type:id]]` or bare `[[Story 3]]`.
 *
 * The parser replaces wikilinks in markdown source with HTML anchor tokens
 * carrying data-attributes. The page-level wikilink JS (in layout.ts) opens
 * a popover that fetches the resolved fragment from /p/<slug>/ref?…
 *
 * Resolver lives server-side; this module only handles parsing + chip
 * rendering.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { renderMarkdown } from "./markdown.ts";
import { parseConcerns, parseOpenQuestions } from "./atomic-items.ts";
import { escape } from "./html.ts";

export type WikilinkType =
  | "story"
  | "concern"
  | "question"
  | "prototype"
  | "arch"
  | "spec"
  | "plan"
  | "wiki"
  | "code"
  | "feedback"
  | "feature";

export interface ParsedWikilink {
  raw: string;
  type: WikilinkType | "unknown";
  id: string;
  label: string;
}

const TYPE_LABEL: Record<string, string> = {
  story: "story",
  concern: "concern",
  question: "question",
  prototype: "prototype",
  arch: "arch",
  spec: "spec",
  plan: "plan",
  wiki: "wiki",
  code: "code",
  feedback: "feedback",
  feature: "feature",
};

const KNOWN_TYPES: ReadonlySet<string> = new Set(Object.keys(TYPE_LABEL));

const SUGAR_RE = /^([A-Z][a-z]+)\s+(\S.*)$/; // "Story 3" → story:3

export function parseWikilink(inner: string): ParsedWikilink {
  const trimmed = inner.trim();
  // type:id form
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx > 0) {
    const t = trimmed.slice(0, colonIdx).toLowerCase();
    const id = trimmed.slice(colonIdx + 1);
    if (KNOWN_TYPES.has(t)) {
      return { raw: inner, type: t as WikilinkType, id, label: `${t}:${id}` };
    }
  }
  // sugar: "Story 3"
  const sugar = trimmed.match(SUGAR_RE);
  if (sugar) {
    const t = sugar[1]!.toLowerCase();
    if (KNOWN_TYPES.has(t)) {
      return { raw: inner, type: t as WikilinkType, id: sugar[2]!, label: trimmed };
    }
  }
  return { raw: inner, type: "unknown", id: trimmed, label: trimmed };
}

/**
 * Replace [[…]] tokens in markdown source with anchor tokens. We do this
 * before passing to markdown-it so the anchor survives rendering.
 */
export function injectWikilinks(
  markdownSource: string,
  context: { projectSlug: string; featureSlug: string },
): string {
  return markdownSource.replace(/\[\[([^\[\]]+)\]\]/g, (_full, inner: string) => {
    const w = parseWikilink(inner);
    if (w.type === "unknown") {
      return `<span class="wikilink wikilink-unknown" title="Unknown wikilink type">${escape(w.label)}</span>`;
    }
    const dataType = w.type;
    const dataId = encodeURIComponent(w.id);
    const dataFeature = encodeURIComponent(context.featureSlug);
    const dataProject = encodeURIComponent(context.projectSlug);
    return `<a class="wikilink" href="/p/${dataProject}/ref?type=${dataType}&id=${dataId}&feature=${dataFeature}" data-type="${dataType}" data-id="${dataId}" data-feature="${dataFeature}" data-project="${dataProject}">${escape(w.label)}</a>`;
  });
}

/* ----- Resolver ----- */

interface ResolveCtx {
  projectPath: string;
  featureSlug: string;
}

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function readSafe(path: string): string {
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function featureDir(ctx: ResolveCtx, slug?: string): string {
  return join(ctx.projectPath, "docs", "roadmap", slug ?? ctx.featureSlug);
}

function findHeadingSection(markdownSource: string, headingSlug: string, levels: number[] = [2, 3]): string {
  const text = matter(markdownSource).content;
  const lines = text.split("\n");
  let startIdx = -1;
  let foundLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^(#{1,6})\s+(.+)$/);
    if (!m) continue;
    const level = m[1]!.length;
    if (!levels.includes(level)) continue;
    const title = m[2]!.trim();
    if (slugify(title) === headingSlug) {
      startIdx = i;
      foundLevel = level;
      break;
    }
  }
  if (startIdx === -1) return "";
  const out: string[] = [lines[startIdx]!];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const m = lines[i]!.match(/^(#{1,6})\s+/);
    if (m && m[1]!.length <= foundLevel) break;
    out.push(lines[i]!);
  }
  return out.join("\n");
}

export interface ResolvedRef {
  title: string;
  body: string;
  openHref?: string; // file:// or /p/<slug>/files/... for "open in new tab"
}

export function resolveRef(
  ctx: ResolveCtx,
  type: string,
  id: string,
): ResolvedRef | null {
  const feature = featureDir(ctx);

  switch (type) {
    case "story": {
      const path = join(feature, "user-stories.md");
      const src = readSafe(path);
      if (!src) return null;
      const idTrimmed = id.trim();
      const section = findHeadingSection(src, slugify(`${idTrimmed} `), [3])
        || findHeadingSection(src, slugify(idTrimmed), [3])
        || extractStoryByNumber(src, idTrimmed);
      if (!section) return null;
      return { title: `Story ${idTrimmed}`, body: section, openHref: pathToOpen(ctx, "user-stories.md") };
    }

    case "concern": {
      const path = join(feature, "concerns.md");
      const src = readSafe(path);
      if (!src) return null;
      const items = parseConcerns(src);
      const found = items.find((it) => it.id === id.trim());
      if (!found) return null;
      return { title: `Concern ${found.id}: ${found.title}`, body: found.body, openHref: pathToOpen(ctx, "concerns.md") };
    }

    case "question": {
      const path = join(feature, "open-questions.md");
      const src = readSafe(path);
      if (!src) return null;
      const items = parseOpenQuestions(src);
      const found = items.find((it) => it.id === id.trim());
      if (!found) return null;
      return { title: `Question ${found.id}: ${found.title}`, body: found.body, openHref: pathToOpen(ctx, "open-questions.md") };
    }

    case "prototype": {
      const filename = id.endsWith(".html") ? id : `${id}.html`;
      const path = join(feature, "prototypes", filename);
      if (!existsSync(path)) return null;
      const fileRoute = `/p/${encodeURIComponent(ctxToSlug(ctx))}/files/docs/roadmap/${encodeURIComponent(ctx.featureSlug)}/prototypes/${encodeURIComponent(filename)}`;
      return {
        title: `Prototype: ${filename}`,
        body: `<iframe class="wikilink-iframe" src="${fileRoute}" loading="lazy"></iframe>`,
        openHref: fileRoute,
      };
    }

    case "arch":
    case "spec":
    case "plan": {
      const fileMap: Record<string, string> = { arch: "architecture.md", spec: "spec.md", plan: "plan.md" };
      const path = join(feature, fileMap[type]!);
      const src = readSafe(path);
      if (!src) return null;
      const sectionSlug = slugify(id);
      const section = findHeadingSection(src, sectionSlug, [2, 3, 4]) || src;
      return { title: `${type}:${id}`, body: section, openHref: pathToOpen(ctx, fileMap[type]!) };
    }

    case "wiki": {
      const candidates = [
        join(ctx.projectPath, "wiki", "pages", `${id}.md`),
        join(ctx.projectPath, "wiki", `${id}.md`),
        join(ctx.projectPath, "docs", "wiki", `${id}.md`),
      ];
      for (const path of candidates) {
        if (existsSync(path)) {
          return { title: `wiki: ${id}`, body: readSafe(path), openHref: pathToOpenAbsolute(ctx, path) };
        }
      }
      return null;
    }

    case "code": {
      // code:path:line OR code:path
      const lastColon = id.lastIndexOf(":");
      const looksLikeLine = lastColon > 0 && /^\d+$/.test(id.slice(lastColon + 1));
      const relPath = looksLikeLine ? id.slice(0, lastColon) : id;
      const line = looksLikeLine ? id.slice(lastColon + 1) : null;
      const abs = join(ctx.projectPath, relPath);
      if (!existsSync(abs)) return { title: `code:${id}`, body: `<p class="muted">File not found at <code>${escape(abs)}</code>.</p>` };
      const fileRoute = `/p/${encodeURIComponent(ctxToSlug(ctx))}/files/${relPath
        .split("/")
        .map((s) => encodeURIComponent(s))
        .join("/")}`;
      const body = line
        ? `<p>Code reference: <code>${escape(relPath)}:${escape(line)}</code></p><p><a href="${fileRoute}" target="_blank">Open file</a></p>`
        : `<p>Code reference: <code>${escape(relPath)}</code></p><p><a href="${fileRoute}" target="_blank">Open file</a></p>`;
      return { title: `code:${id}`, body, openHref: fileRoute };
    }

    case "feedback": {
      const filename = id.endsWith(".md") ? id : `${id}.md`;
      const path = join(feature, "feedback", filename);
      if (!existsSync(path)) return null;
      return { title: `feedback: ${filename}`, body: readSafe(path), openHref: pathToOpenAbsolute(ctx, path) };
    }

    case "feature": {
      const slug = id.trim();
      const otherDir = join(ctx.projectPath, "docs", "roadmap", slug);
      const readme = join(otherDir, "README.md");
      if (!existsSync(readme)) return null;
      const src = readSafe(readme);
      const fm = matter(src);
      const title = (fm.data.title as string) ?? slug;
      const summaryLines = fm.content.split("\n").slice(0, 8).join("\n");
      return {
        title: `feature: ${title}`,
        body: `${summaryLines}\n\n*[Open feature page →](/p/${encodeURIComponent(ctxToSlug(ctx))}/roadmap/${encodeURIComponent(slug)})*`,
        openHref: `/p/${encodeURIComponent(ctxToSlug(ctx))}/roadmap/${encodeURIComponent(slug)}`,
      };
    }
  }
  return null;
}

function ctxToSlug(ctx: ResolveCtx): string {
  // Best-effort: use the basename of the project path. The caller normally
  // knows the slug; we receive it via context construction in the server.
  return ctx.projectPath.split("/").pop() ?? "";
}

function pathToOpen(ctx: ResolveCtx, relInFeature: string): string {
  return `/p/${encodeURIComponent(ctxToSlug(ctx))}/files/docs/roadmap/${encodeURIComponent(ctx.featureSlug)}/${encodeURIComponent(relInFeature)}`;
}

function pathToOpenAbsolute(ctx: ResolveCtx, abs: string): string {
  const rel = abs.slice(ctx.projectPath.length + 1);
  return `/p/${encodeURIComponent(ctxToSlug(ctx))}/files/${rel.split("/").map((s) => encodeURIComponent(s)).join("/")}`;
}

function extractStoryByNumber(src: string, n: string): string {
  // Match `### N. Title` heading
  const text = matter(src).content;
  const lines = text.split("\n");
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^###\s+(\d+)\.\s+/);
    if (m && m[1] === n.trim()) { startIdx = i; break; }
  }
  if (startIdx === -1) return "";
  const out: string[] = [lines[startIdx]!];
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^###\s+\d+\.\s+/.test(lines[i]!) || /^##\s+/.test(lines[i]!)) break;
    out.push(lines[i]!);
  }
  return out.join("\n");
}

/**
 * Render a ResolvedRef into HTML for the popover. If the body is markdown
 * (no leading <), render it as markdown; otherwise treat as raw HTML.
 */
export function renderResolvedRef(ref: ResolvedRef, projectSlug: string, featureSlug: string): string {
  const looksLikeHtml = /^\s*</.test(ref.body);
  const inner = looksLikeHtml
    ? ref.body
    : injectWikilinks(ref.body, { projectSlug, featureSlug });
  const rendered = looksLikeHtml ? inner : renderMarkdown(inner).html;
  const openLink = ref.openHref ? `<a class="ref-open" href="${escape(ref.openHref)}" target="_blank">open in new tab →</a>` : "";
  return `
    <div class="wikilink-popover">
      <div class="wikilink-popover-head">
        <strong>${escape(ref.title)}</strong>
        ${openLink}
      </div>
      <div class="wikilink-popover-body markdown-body">${rendered}</div>
    </div>`;
}
