import type { Project } from "../types.ts";
import { renderFeaturePage } from "../plugins/roadmap.ts";
import { layout } from "./layout.ts";
import { escape } from "../util/html.ts";

export function renderFeature(
  project: Project,
  slug: string,
  flash?: { ok: boolean; output: string },
): string | null {
  const body = renderFeaturePage(project, slug);
  if (!body) return null;
  const flashHtml = flash
    ? `<div class="flash ${flash.ok ? "ok" : "attention"}">${escape(flash.output || (flash.ok ? "Done" : "Failed"))}</div>`
    : "";
  return layout({
    title: `${slug} — ${project.name}`,
    body: flashHtml + body,
    breadcrumbs: [
      { label: "projects", href: "/" },
      { label: project.name, href: `/p/${project.slug}` },
      { label: slug },
    ],
  });
}
