import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "../types.ts";
import { escape, fileUrl } from "../util/html.ts";
import { readFrontmatter } from "../util/frontmatter.ts";

interface SkillEntry {
  id: string;
  name: string;
  description: string;
  path: string;
  source: string;
}

function skillsRoots(projectPath: string): { dir: string; source: string }[] {
  const roots: { dir: string; source: string }[] = [];
  for (const candidate of [".claude/skills", ".agents/skills"]) {
    const p = join(projectPath, candidate);
    if (existsSync(p) && statSync(p).isDirectory()) {
      roots.push({ dir: p, source: candidate });
    }
  }
  return roots;
}

function listSkills(projectPath: string): SkillEntry[] {
  const out: SkillEntry[] = [];
  for (const root of skillsRoots(projectPath)) {
    let entries: string[] = [];
    try {
      entries = readdirSync(root.dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const skillDir = join(root.dir, entry);
      let st;
      try {
        st = statSync(skillDir);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      const skillFile = join(skillDir, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      const fm = readFrontmatter(skillFile);
      const name = (fm?.data.name as string) ?? entry;
      const description = (fm?.data.description as string) ?? "";
      out.push({
        id: entry,
        name,
        description,
        path: skillFile,
        source: root.source,
      });
    }
  }
  return out;
}

export const skillsPlugin: Plugin = {
  id: "skills",
  label: "Skills",

  detect(project) {
    return skillsRoots(project.path).length > 0;
  },

  render(ctx) {
    const skills = listSkills(ctx.project.path);
    if (skills.length === 0) {
      return `<p class="muted">No skills found.</p>`;
    }
    const rows = skills
      .map(
        (s) => `
        <tr>
          <td><strong>${escape(s.name)}</strong></td>
          <td>${escape(s.description)}</td>
          <td><code>${escape(s.source)}/${escape(s.id)}</code></td>
          <td><a href="${escape(fileUrl(s.path))}">open</a></td>
        </tr>`,
      )
      .join("");
    return `
      <table>
        <thead><tr><th>Skill</th><th>Description</th><th>Source</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  },

  summary(ctx) {
    const skills = listSkills(ctx.project.path);
    return skills.length > 0 ? `${skills.length} skill${skills.length === 1 ? "" : "s"}` : "";
  },
};
