import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "../types.ts";
import { escape, fileUrl } from "../util/html.ts";

function wikiDir(project: { path: string; manifest: { wiki?: { dir?: string } } }): string | null {
  const override = project.manifest.wiki?.dir;
  const candidates = override ? [override] : ["wiki/pages", "wiki", "docs/wiki"];
  for (const rel of candidates) {
    const p = join(project.path, rel);
    if (existsSync(p) && statSync(p).isDirectory()) return p;
  }
  return null;
}

function listMarkdown(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort();
  } catch {
    return [];
  }
}

export const wikiPlugin: Plugin = {
  id: "wiki",
  label: "Wiki",

  detect(project) {
    return wikiDir(project as any) !== null;
  },

  render(ctx) {
    const dir = wikiDir(ctx.project as any);
    if (!dir) return `<p class="muted">No wiki found.</p>`;
    const files = listMarkdown(dir);
    if (files.length === 0) return `<p class="muted">No wiki pages.</p>`;
    const items = files
      .map(
        (f) =>
          `<li><a href="${escape(fileUrl(join(dir, f)))}">${escape(f.replace(/\.md$/, ""))}</a></li>`,
      )
      .join("");
    return `<ul>${items}</ul><p class="muted"><code>${escape(dir)}</code></p>`;
  },

  summary(ctx) {
    const dir = wikiDir(ctx.project as any);
    if (!dir) return "";
    const files = listMarkdown(dir);
    return files.length > 0 ? `${files.length} page${files.length === 1 ? "" : "s"}` : "";
  },
};
