import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import type {
  HubConfig,
  Project,
  ProjectConfig,
  ProjectManifest,
} from "./types.ts";
import { plugins } from "./plugins/index.ts";

export function loadConfig(path: string): HubConfig {
  const raw = readFileSync(path, "utf8");
  const parsed = YAML.parse(raw) as HubConfig;
  parsed.port = parsed.port ?? 7777;
  return parsed;
}

function readManifest(projectPath: string): ProjectManifest {
  const candidates = [".meta.yaml", ".meta.yml"];
  for (const name of candidates) {
    const p = join(projectPath, name);
    if (existsSync(p)) {
      try {
        return YAML.parse(readFileSync(p, "utf8")) as ProjectManifest;
      } catch (e) {
        console.error(`Failed to parse manifest at ${p}:`, e);
      }
    }
  }
  return {};
}

export async function discoverProjects(config: HubConfig): Promise<Project[]> {
  const projects: Project[] = [];
  for (const cfg of config.projects) {
    const project = await resolveProject(cfg);
    if (project) projects.push(project);
  }
  return projects;
}

async function resolveProject(cfg: ProjectConfig): Promise<Project | null> {
  if (!existsSync(cfg.path)) {
    console.warn(`Project path missing: ${cfg.path}`);
    return null;
  }
  const manifest = readManifest(cfg.path);
  const status = manifest.status ?? cfg.status ?? "active";
  const slug = cfg.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  const project: Project = {
    name: manifest.name ?? cfg.name,
    slug,
    path: cfg.path,
    status,
    description: manifest.description,
    manifest,
    plugins: [],
  };

  if (manifest.plugins && manifest.plugins.length > 0) {
    project.plugins = manifest.plugins.filter((p) =>
      plugins.some((pl) => pl.id === p),
    );
  } else {
    for (const plugin of plugins) {
      try {
        if (await plugin.detect(project)) project.plugins.push(plugin.id);
      } catch (e) {
        console.error(`Plugin ${plugin.id} detect failed for ${cfg.name}:`, e);
      }
    }
  }

  return project;
}

export function findProject(projects: Project[], slug: string): Project | null {
  return projects.find((p) => p.slug === slug) ?? null;
}

export function getPlugin(id: string) {
  return plugins.find((p) => p.id === id) ?? null;
}
