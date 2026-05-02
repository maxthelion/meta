import MarkdownIt from "markdown-it";
import matter from "gray-matter";

const md = new MarkdownIt({ html: false, linkify: true, typographer: false });

export interface RenderedMarkdown {
  html: string;
  frontmatter: Record<string, unknown>;
}

export function renderMarkdown(source: string): RenderedMarkdown {
  const parsed = matter(source);
  let html = md.render(parsed.content);

  // Promote ```mermaid``` code blocks into <div class="mermaid">…</div> so the
  // page-level mermaid loader (in render/layout.ts) picks them up. The
  // markdown-it default escapes the contents; mermaid wants raw text.
  html = html.replace(
    /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
    (_match, code: string) => {
      const text = code
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      return `<div class="mermaid">${text}</div>`;
    },
  );

  return { html, frontmatter: parsed.data as Record<string, unknown> };
}
