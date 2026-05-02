import type { Project } from "../types.ts";
import { plugins } from "../plugins/index.ts";
import { escape } from "../util/html.ts";
import { layout } from "./layout.ts";

export async function renderHome(projects: Project[]): Promise<string> {
  const cards: string[] = [];
  for (const project of projects) {
    const summaries: string[] = [];
    for (const pluginId of project.plugins) {
      const plugin = plugins.find((p) => p.id === pluginId);
      if (!plugin?.summary) continue;
      try {
        const s = await plugin.summary({ project });
        if (s) summaries.push(`<span class="badge">${escape(plugin.label)}: ${escape(s)}</span>`);
      } catch (e) {
        console.error(`summary failed for ${pluginId} ${project.slug}:`, e);
      }
    }
    if (summaries.length === 0) {
      summaries.push(
        ...project.plugins.map(
          (id) => `<span class="badge">${escape(plugins.find((p) => p.id === id)?.label ?? id)}</span>`,
        ),
      );
    }
    cards.push(`
      <a class="project-card ${project.status}" href="/p/${escape(project.slug)}">
        <h2>${escape(project.name)} <span class="badge ${project.status}">${escape(project.status)}</span></h2>
        ${project.description ? `<div class="desc">${escape(project.description)}</div>` : ""}
        <div>${summaries.join(" ")}</div>
      </a>`);
  }

  const body = `
    <h1>Projects</h1>
    <p class="muted">Central command view of projects under <code>~/dev</code>. Each project keeps its own artefacts; this hub reads and surfaces them.</p>
    <p><a class="button-link" href="/orchestrator">Open orchestrator</a></p>
    <div class="grid">
      ${cards.join("")}
    </div>`;

  return layout({ title: "meta — projects", body });
}
