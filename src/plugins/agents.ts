import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "../types.ts";
import { escape, fileUrl } from "../util/html.ts";
import { readFrontmatter } from "../util/frontmatter.ts";

interface AgentEntry {
  id: string;
  name: string;
  description: string;
  path: string;
  source: string;
}

function agentRoots(projectPath: string): { dir: string; source: string }[] {
  const roots: { dir: string; source: string }[] = [];
  for (const candidate of [".claude/agents", ".agents/agents"]) {
    const p = join(projectPath, candidate);
    if (existsSync(p) && statSync(p).isDirectory()) {
      roots.push({ dir: p, source: candidate });
    }
  }
  return roots;
}

function listAgents(projectPath: string): AgentEntry[] {
  const out: AgentEntry[] = [];
  for (const root of agentRoots(projectPath)) {
    let entries: string[] = [];
    try {
      entries = readdirSync(root.dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const file = join(root.dir, entry);
      const fm = readFrontmatter(file);
      const name = (fm?.data.name as string) ?? entry.replace(/\.md$/, "");
      const description = (fm?.data.description as string) ?? "";
      out.push({
        id: entry,
        name,
        description,
        path: file,
        source: root.source,
      });
    }
  }
  return out;
}

export const agentsPlugin: Plugin = {
  id: "agents",
  label: "Agents",

  detect(project) {
    return agentRoots(project.path).length > 0;
  },

  render(ctx) {
    const agents = listAgents(ctx.project.path);
    if (agents.length === 0) return `<p class="muted">No agents found.</p>`;
    const rows = agents
      .map(
        (a) => `
        <tr>
          <td><strong>${escape(a.name)}</strong></td>
          <td>${escape(a.description)}</td>
          <td><code>${escape(a.source)}</code></td>
          <td><a href="${escape(fileUrl(a.path))}">open</a></td>
        </tr>`,
      )
      .join("");
    return `
      <table>
        <thead><tr><th>Agent</th><th>Description</th><th>Source</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  },

  summary(ctx) {
    const agents = listAgents(ctx.project.path);
    return agents.length > 0 ? `${agents.length} agent${agents.length === 1 ? "" : "s"}` : "";
  },
};
