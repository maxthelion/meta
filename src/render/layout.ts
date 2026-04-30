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
</body>
</html>`;
}
