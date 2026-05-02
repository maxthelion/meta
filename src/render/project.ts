import type { Project } from "../types.ts";
import { plugins } from "../plugins/index.ts";
import { escape, fileUrl } from "../util/html.ts";
import { layout } from "./layout.ts";

// Plugins whose output drives daily action. Rendered prominently.
const PRIMARY_PLUGINS = new Set(["roadmap"]);

export async function renderProject(
  project: Project,
  flash?: { ok: boolean; output: string },
): Promise<string> {
  const primary: string[] = [];
  const reference: string[] = [];

  for (const pluginId of project.plugins) {
    const plugin = plugins.find((p) => p.id === pluginId);
    if (!plugin) continue;
    let html: string;
    try {
      html = await plugin.render({ project });
    } catch (e) {
      console.error(`render failed for ${pluginId} on ${project.slug}:`, e);
      html = `<p class="attention">Render failed: ${escape((e as Error).message)}</p>`;
    }
    const section = `
      <section class="plugin-section">
        <h2>${escape(plugin.label)}</h2>
        ${html}
      </section>`;
    if (PRIMARY_PLUGINS.has(plugin.id)) primary.push(section);
    else reference.push(section);
  }

  const flashHtml = flash
    ? `<div class="flash ${flash.ok ? "ok" : "attention"}">${escape(flash.output || (flash.ok ? "Done" : "Failed"))}</div>`
    : "";

  const referenceBlock = reference.length === 0
    ? ""
    : `
      <details class="project-tools-details">
        <summary>Project tools (${reference.length} sections: skills, agents, wiki, git)</summary>
        ${reference.join("")}
      </details>`;

  const body = `
    ${flashHtml}
    <h1>${escape(project.name)} <span class="badge ${project.status}">${escape(project.status)}</span></h1>
    <p class="muted"><a href="${escape(fileUrl(project.path))}">${escape(project.path)}</a></p>
    ${project.description ? `<p>${escape(project.description)}</p>` : ""}
    ${primary.join("")}
    ${referenceBlock}`;

  return layout({
    title: `${project.name} — meta`,
    body,
    breadcrumbs: [{ label: "projects", href: "/" }, { label: project.name }],
  });
}
