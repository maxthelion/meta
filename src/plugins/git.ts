import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "../types.ts";
import { escape } from "../util/html.ts";

async function gitLog(cwd: string, n: number): Promise<string[]> {
  const proc = Bun.spawn(
    ["git", "log", `--max-count=${n}`, "--pretty=format:%h\t%ad\t%s", "--date=short"],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.split("\n").filter(Boolean);
}

export const gitPlugin: Plugin = {
  id: "git",
  label: "Git Activity",

  detect(project) {
    return existsSync(join(project.path, ".git"));
  },

  async render(ctx) {
    let lines: string[] = [];
    try {
      lines = await gitLog(ctx.project.path, 8);
    } catch {
      return `<p class="muted">Git log unavailable.</p>`;
    }
    if (lines.length === 0) {
      return `<p class="muted">No commits.</p>`;
    }
    const rows = lines
      .map((line) => {
        const [sha, date, ...rest] = line.split("\t");
        const subject = rest.join("\t");
        return `<li><code>${escape(sha)}</code> <span class="muted">${escape(date)}</span> ${escape(subject)}</li>`;
      })
      .join("\n");
    return `<ul>${rows}</ul>`;
  },

  async summary(ctx) {
    try {
      const lines = await gitLog(ctx.project.path, 1);
      if (lines.length === 0) return "no commits";
      const [, date] = lines[0]!.split("\t");
      return `last commit ${date}`;
    } catch {
      return "";
    }
  },
};
