import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Project } from "../types.ts";

export type LeaseKind =
  | "build-worktree"
  | "bootstrap-build-loop"
  | "pm-agent"
  | "user-attention"
  | "ready-for-user";

export type LeaseStatus = "granted" | "queued" | "blocked" | "attention" | "ready";

export interface LeaseCandidate {
  id: string;
  kind: LeaseKind;
  status: LeaseStatus;
  priority: number;
  project: string;
  projectSlug: string;
  title: string;
  cwd: string;
  subtree: string;
  action: string;
  role: string;
  reason: string;
  command: string[];
  exclusive: string[];
  sharedLimits: string[];
  source: string;
}

export interface OrchestratorOptions {
  refreshSelectors?: boolean;
  maxLeases?: number;
  maxPmLeases?: number;
  maxBuildLeases?: number;
  maxXcodebuildLeases?: number;
}

export interface OrchestratorModel {
  generatedAt: string;
  limits: {
    maxLeases: number;
    maxPmLeases: number;
    maxBuildLeases: number;
    maxXcodebuildLeases: number;
  };
  granted: LeaseCandidate[];
  queued: LeaseCandidate[];
  attention: LeaseCandidate[];
  ready: LeaseCandidate[];
  blocked: LeaseCandidate[];
  all: LeaseCandidate[];
}

interface ScheduleLimits {
  maxLeases: number;
  maxPmLeases: number;
  maxBuildLeases: number;
  maxXcodebuildLeases: number;
}

const DEFAULT_LIMITS = {
  maxLeases: 4,
  maxPmLeases: 3,
  maxBuildLeases: 2,
  maxXcodebuildLeases: 1,
};

const META_ROOT = fileURLToPath(new URL("../..", import.meta.url));

function safeRead(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function runQuiet(cwd: string, command: string[]): void {
  try {
    execFileSync(command[0]!, command.slice(1), { cwd, stdio: "ignore" });
  } catch {
    // Selectors are advisory for the central model. A failing selector should
    // not prevent other independent subtrees from being scheduled.
  }
}

function gitValue(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function parseMarkdownSection(text: string, heading: string): string {
  const start = text.indexOf(`## ${heading}`);
  if (start < 0) return "";
  const rest = text.slice(start + heading.length + 3);
  const next = rest.search(/\n## /);
  return next >= 0 ? rest.slice(0, next) : rest;
}

function sectionValue(section: string, key: string): string {
  const re = new RegExp(`^- \\*\\*${key}:\\*\\* (.*)$`, "m");
  const match = section.match(re);
  return match ? match[1]!.trim().replace(/^`|`$/g, "") : "";
}

function parseAction(text: string): string {
  return text.match(/^## Action: (.+)$/m)?.[1]?.trim() ?? "";
}

function shouldUseXcodebuild(action: string): boolean {
  return /test|critique|work-item|execute|fix|review|select-work-item/.test(action);
}

function parsePmLeases(project: Project, refreshSelectors: boolean): LeaseCandidate[] {
  const roadmapDir = join(project.path, "docs", "roadmap");
  const script = join(project.path, "scripts", "roadmap", "next-roadmap-actions.sh");
  const outFile = join(roadmapDir, "next-actions.md");
  if (!existsSync(roadmapDir) || !existsSync(script)) return [];

  if (refreshSelectors) runQuiet(project.path, [script]);
  const text = safeRead(outFile);
  if (!text) return [];

  const leases: LeaseCandidate[] = [];
  const userSection = parseMarkdownSection(text, "Next User Item");
  const agentSection = parseMarkdownSection(text, "Next Agent Item");

  const userItem = sectionValue(userSection, "Item");
  if (userItem) {
    const feature = sectionValue(userSection, "Feature");
    const action = sectionValue(userSection, "Action");
    leases.push({
      id: `pm-user:${project.slug}:${userItem}`,
      kind: "user-attention",
      status: "attention",
      priority: 10,
      project: project.name,
      projectSlug: project.slug,
      title: `Item ${userItem}: ${feature}`,
      cwd: project.path,
      subtree: "pm-loop",
      action,
      role: "user",
      reason: sectionValue(userSection, "Why"),
      command: [],
      exclusive: [`project:${project.slug}:roadmap-user-input`],
      sharedLimits: [],
      source: outFile,
    });
  }

  const agentItem = sectionValue(agentSection, "Item");
  if (agentItem) {
    const feature = sectionValue(agentSection, "Feature");
    const action = sectionValue(agentSection, "Action");
    leases.push({
      id: `pm-agent:${project.slug}:${agentItem}`,
      kind: "pm-agent",
      status: "queued",
      priority: 60,
      project: project.name,
      projectSlug: project.slug,
      title: `Item ${agentItem}: ${feature}`,
      cwd: project.path,
      subtree: "pm-loop",
      action,
      role: sectionValue(agentSection, "Role") || "pm-assistant",
      reason: sectionValue(agentSection, "Why"),
      command: ["pm-next-action"],
      exclusive: [
        `cwd:${project.path}`,
        `project:${project.slug}:roadmap-generated-files`,
        `roadmap-item:${project.slug}:${agentItem}`,
      ],
      sharedLimits: ["pm"],
      source: outFile,
    });
  }

  return leases;
}

function worktreeTitle(name: string): { id: string; slug: string; title: string } {
  const match = name.match(/^roadmap-(\d+)-(.+)$/);
  if (!match) return { id: "?", slug: name, title: name };
  const slug = match[2]!;
  const title = slug
    .split("-")
    .map((p) => p.slice(0, 1).toUpperCase() + p.slice(1))
    .join(" ");
  return { id: match[1]!, slug, title };
}

function parseBuildWorktree(project: Project, path: string, refreshSelectors: boolean): LeaseCandidate[] {
  const name = path.split("/").pop()!;
  const { id, slug, title } = worktreeTitle(name);
  const selector = join(path, "scripts", "build-loop", "select-build-action.sh");
  const readyFile = join(path, ".claude", "state", "ready-for-user.md");
  const source = join(path, ".claude", "state", "next-action.md");
  const branch = gitValue(path, ["rev-parse", "--abbrev-ref", "HEAD"]) || name;
  const exclusive = [`cwd:${path}`, `branch:${branch}`, `roadmap-item:${project.slug}:${id}`];

  if (!existsSync(selector)) {
    return [{
      id: `bootstrap-build:${project.slug}:${name}`,
      kind: "bootstrap-build-loop",
      status: "queued",
      priority: 35,
      project: project.name,
      projectSlug: project.slug,
      title: `Item ${id}: ${title}`,
      cwd: path,
      subtree: "bootstrap",
      action: "install-build-loop",
      role: "orchestrator",
      reason: "Promoted worktree exists but build-loop is not installed.",
      command: ["bun", join(META_ROOT, "src", "cli", "bundle.ts"), "install", "--kind", "build-loop", path],
      exclusive,
      sharedLimits: ["bootstrap"],
      source: path,
    }];
  }

  if (refreshSelectors) runQuiet(path, [selector]);

  if (existsSync(readyFile)) {
    return [{
      id: `ready:${project.slug}:${name}`,
      kind: "ready-for-user",
      status: "ready",
      priority: 5,
      project: project.name,
      projectSlug: project.slug,
      title: `Item ${id}: ${title}`,
      cwd: path,
      subtree: "build-loop",
      action: "ready-for-user",
      role: "user",
      reason: "Build worktree has signalled ready-for-user.",
      command: [],
      exclusive,
      sharedLimits: [],
      source: readyFile,
    }];
  }

  const text = safeRead(source);
  const action = parseAction(text) || "unknown";
  const limits = ["build"];
  if (shouldUseXcodebuild(action)) limits.push("xcodebuild");

  return [{
    id: `build:${project.slug}:${name}`,
    kind: "build-worktree",
    status: "queued",
    priority: action === "surface-inbox-question" ? 12 : action === "fix-tests" ? 20 : action === "address-critique" ? 25 : 45,
    project: project.name,
    projectSlug: project.slug,
    title: `Item ${id}: ${title}`,
    cwd: path,
    subtree: "build-loop",
    action,
    role: action === "surface-inbox-question" ? "user" : "build-next-action",
    reason: text.match(/\n\n([^\n].*?)\n\n/s)?.[1]?.trim() ?? "Build-loop selector action.",
    command: ["build-next-action"],
    exclusive,
    sharedLimits: limits,
    source,
  }];
}

function parseBuildLeases(project: Project, refreshSelectors: boolean): LeaseCandidate[] {
  const root = join(project.path, ".worktrees");
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => name.startsWith("roadmap-"))
    .map((name) => join(root, name))
    .filter((path) => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    })
    .flatMap((path) => parseBuildWorktree(project, path, refreshSelectors));
}

function applySchedule(candidates: LeaseCandidate[], opts: ScheduleLimits): LeaseCandidate[] {
  const exclusive = new Set<string>();
  const shared = new Map<string, number>();
  const maxFor = (key: string) => {
    if (key === "pm") return opts.maxPmLeases;
    if (key === "build") return opts.maxBuildLeases;
    if (key === "xcodebuild") return opts.maxXcodebuildLeases;
    return opts.maxLeases;
  };

  let granted = 0;
  return candidates
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    .map((candidate) => {
      if (candidate.status !== "queued") return candidate;
      const conflicts = candidate.exclusive.some((key) => exclusive.has(key));
      const sharedBlocked = candidate.sharedLimits.some((key) => (shared.get(key) ?? 0) >= maxFor(key));
      if (granted >= opts.maxLeases || conflicts || sharedBlocked) {
        return { ...candidate, status: "blocked" as const };
      }

      granted++;
      for (const key of candidate.exclusive) exclusive.add(key);
      for (const key of candidate.sharedLimits) shared.set(key, (shared.get(key) ?? 0) + 1);
      return { ...candidate, status: "granted" as const };
    });
}

export function buildOrchestratorModel(projects: Project[], options: OrchestratorOptions = {}): OrchestratorModel {
  const limits = { ...DEFAULT_LIMITS, ...options };
  const candidates = projects
    .filter((project) => project.status !== "archived")
    .flatMap((project) => [
      ...parseBuildLeases(project, Boolean(options.refreshSelectors)),
      ...parsePmLeases(project, Boolean(options.refreshSelectors)),
    ]);

  const scheduled = applySchedule(candidates, limits);

  return {
    generatedAt: new Date().toISOString(),
    limits: {
      maxLeases: limits.maxLeases,
      maxPmLeases: limits.maxPmLeases,
      maxBuildLeases: limits.maxBuildLeases,
      maxXcodebuildLeases: limits.maxXcodebuildLeases,
    },
    granted: scheduled.filter((l) => l.status === "granted"),
    queued: scheduled.filter((l) => l.status === "queued"),
    attention: scheduled.filter((l) => l.status === "attention"),
    ready: scheduled.filter((l) => l.status === "ready"),
    blocked: scheduled.filter((l) => l.status === "blocked"),
    all: scheduled,
  };
}
