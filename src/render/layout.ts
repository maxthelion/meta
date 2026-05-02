import { escape } from "../util/html.ts";

export interface LayoutOpts {
  title: string;
  body: string;
  breadcrumbs?: { label: string; href?: string }[];
}

export function layout(opts: LayoutOpts): string {
  const crumbs = (opts.breadcrumbs ?? [])
    .map((c) =>
      c.href
        ? `<a href="${escape(c.href)}">${escape(c.label)}</a>`
        : `<span>${escape(c.label)}</span>`,
    )
    .join(' <span class="muted">/</span> ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(opts.title)}</title>
<link rel="stylesheet" href="/static/style.css">
</head>
<body>
<header>
  <div class="topnav">
    <a href="/" class="brand">meta</a>
    ${crumbs ? `<nav class="crumbs">${crumbs}</nav>` : ""}
  </div>
</header>
<main>
${opts.body}
</main>
<script type="module">
  const diagrams = document.querySelectorAll(".mermaid");
  if (diagrams.length > 0) {
    const mermaid = await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs");
    mermaid.default.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default" });
    await mermaid.default.run({ nodes: diagrams });
  }
</script>
<script>
  // Wikilink expansion: click a [[…]] chip to load its referenced fragment
  // inline; click again or the close button to collapse. Cmd/Ctrl-click
  // navigates instead (fall back to the href).
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a.wikilink");
    if (!a) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    const next = a.nextElementSibling;
    if (next && next.classList && next.classList.contains("wikilink-expanded")) {
      next.remove();
      a.classList.remove("wikilink-open");
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "wikilink-expanded";
    wrap.innerHTML = '<div class="wikilink-loading">Loading…</div>';
    a.after(wrap);
    a.classList.add("wikilink-open");
    fetch(a.href, { headers: { Accept: "text/html" } })
      .then((r) => r.text())
      .then((html) => { wrap.innerHTML = html; })
      .catch((err) => { wrap.innerHTML = '<div class="wikilink-error">Load failed: ' + (err && err.message || err) + '</div>'; });
  });
</script>
</body>
</html>`;
}
