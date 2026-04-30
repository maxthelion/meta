import type { Project } from "../types.ts";
import { plugins } from "../plugins/index.ts";
import { escape, fileUrl } from "../util/html.ts";
import { layout } from "./layout.ts";

export async function renderProject(
  project: Project,
  flash?: { ok: boolean; output: string },
): Promise<string> {
  const sections: string[] = [];
  for (const pluginId of project.plugins) {
    const plugin = plugins.find((p) => p.id === pluginId);
    if (!plugin) continue;
    try {
      const html = await plugin.render({ project });
      sections.push(`
        <section class="plugin-section">
          <h2>${escape(plugin.label)}</h2>
          ${html}
        </section>`);
    } catch (e) {
      console.error(`render failed for ${pluginId} on ${project.slug}:`, e);
      sections.push(`
        <section class="plugin-section">
          <h2>${escape(plugin.label)}</h2>
          <p class="attention">Render failed: ${escape((e as Error).message)}</p>
        </section>`);
    }
  }

  const flashHtml = flash
    ? `<div class="flash ${flash.ok ? "ok" : "attention"}">${escape(flash.output || (flash.ok ? "Done" : "Failed"))}</div>`
    : "";

  const body = `
    ${flashHtml}
    <h1>${escape(project.name)} <span class="badge ${project.status}">${escape(project.status)}</span></h1>
    <p class="muted"><a href="${escape(fileUrl(project.path))}">${escape(project.path)}</a></p>
    ${project.description ? `<p>${escape(project.description)}</p>` : ""}
    ${sections.join("")}`;

  return layout({
    title: `${project.name} — meta`,
    body,
    breadcrumbs: [{ label: "projects", href: "/" }, { label: project.name }],
  });
}
