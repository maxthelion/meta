import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { discoverProjects, findProject, getPlugin, loadConfig } from "./discovery.ts";
import { plugins } from "./plugins/index.ts";
import type { Project } from "./types.ts";
import { renderHome } from "./render/home.ts";
import { renderProject } from "./render/project.ts";
import { renderFeature } from "./render/feature.ts";
import { renderReviewPrototypesPage } from "./plugins/roadmap.ts";
import { layout } from "./render/layout.ts";

const CONFIG_PATH = resolve(import.meta.dir, "..", "config.yaml");
const STATIC_DIR = resolve(import.meta.dir, "..", "static");

const config = loadConfig(CONFIG_PATH);
let projects: Project[] = await discoverProjects(config);
console.log(
  `Discovered ${projects.length} projects:`,
  projects.map((p) => `${p.name}[${p.plugins.join(",")}]`).join(" "),
);

async function rediscover() {
  projects = await discoverProjects(config);
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function notFound(): Response {
  return html(
    `<!doctype html><title>not found</title><h1>not found</h1><p><a href="/">home</a></p>`,
    404,
  );
}

function redirect(to: string, flash?: { ok: boolean; output: string }): Response {
  const headers = new Headers({ Location: to });
  if (flash) {
    const cookie = `flash=${encodeURIComponent(JSON.stringify(flash))}; Path=/; Max-Age=10`;
    headers.append("Set-Cookie", cookie);
  }
  return new Response("", { status: 302, headers });
}

function readFlash(req: Request): { ok: boolean; output: string } | undefined {
  const cookie = req.headers.get("cookie");
  if (!cookie) return undefined;
  const m = cookie.match(/flash=([^;]+)/);
  if (!m) return undefined;
  try {
    return JSON.parse(decodeURIComponent(m[1]!));
  } catch {
    return undefined;
  }
}

async function readForm(req: Request): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    const params = new URLSearchParams(text);
    const out: Record<string, string> = {};
    for (const [k, v] of params) out[k] = v;
    return out;
  }
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const out: Record<string, string> = {};
    for (const [k, v] of form) out[k] = String(v);
    return out;
  }
  return {};
}

const server = Bun.serve({
  port: config.port,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/" && req.method === "GET") {
      return html(await renderHome(projects));
    }

    if (path === "/static/style.css" && req.method === "GET") {
      const file = join(STATIC_DIR, "style.css");
      if (existsSync(file)) {
        return new Response(readFileSync(file, "utf8"), {
          headers: { "Content-Type": "text/css" },
        });
      }
      return notFound();
    }

    if (path === "/refresh" && req.method === "POST") {
      await rediscover();
      return redirect("/", { ok: true, output: "Refreshed projects" });
    }

    const projectMatch = path.match(/^\/p\/([^/]+)(?:\/(.*))?$/);
    if (projectMatch) {
      const slug = projectMatch[1]!;
      const rest = projectMatch[2] ?? "";
      const project = findProject(projects, slug);
      if (!project) return notFound();

      if (rest === "" && req.method === "GET") {
        return html(await renderProject(project, readFlash(req)));
      }

      const featureMatch = rest.match(/^roadmap\/([^/]+)$/);
      if (featureMatch && req.method === "GET") {
        const featureSlug = featureMatch[1]!;
        const out = renderFeature(project, featureSlug, readFlash(req));
        if (!out) return notFound();
        return html(out);
      }

      const reviewMatch = rest.match(/^roadmap\/([^/]+)\/review-prototypes\/(.+)$/);
      if (reviewMatch && req.method === "GET") {
        const featureSlug = reviewMatch[1]!;
        const protoName = decodeURIComponent(reviewMatch[2]!);
        const page = renderReviewPrototypesPage(project, featureSlug, protoName);
        if (!page) return notFound();
        const flash = readFlash(req);
        const flashHtml = flash
          ? `<div class="flash ${flash.ok ? "ok" : "attention"}">${flash.output ? flash.output.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c) : flash.ok ? "Done" : "Failed"}</div>`
          : "";
        return html(
          layout({
            title: page.title,
            body: flashHtml + page.body,
            breadcrumbs: [
              { label: "projects", href: "/" },
              { label: project.name, href: `/p/${project.slug}` },
              { label: featureSlug, href: `/p/${project.slug}/roadmap/${featureSlug}` },
              { label: "review-prototypes" },
            ],
          }),
        );
      }

      if (rest.startsWith("files/") && req.method === "GET") {
        const rel = decodeURIComponent(rest.slice("files/".length));
        if (rel.includes("..") || rel.startsWith("/")) return notFound();
        const abs = resolve(project.path, rel);
        if (!abs.startsWith(project.path + "/")) return notFound();
        if (!existsSync(abs)) return notFound();
        const file = Bun.file(abs);
        return new Response(file);
      }

      const actionMatch = rest.match(/^action\/([^/]+)$/);
      if (actionMatch && req.method === "POST") {
        const actionId = actionMatch[1]!;
        const values = await readForm(req);
        const returnParam = url.searchParams.get("return");
        const returnTo =
          returnParam && returnParam.startsWith(`/p/${project.slug}/`)
            ? returnParam
            : `/p/${project.slug}`;
        for (const pluginId of project.plugins) {
          const plugin = getPlugin(pluginId);
          if (!plugin?.handleAction) continue;
          const supports = plugin.actions?.(project)?.some((a) => a.id === actionId);
          if (!supports) continue;
          try {
            const result = await plugin.handleAction({
              project,
              action: actionId,
              values,
            });
            return redirect(result.redirectTo ?? returnTo, {
              ok: result.ok,
              output: result.output.slice(0, 500),
            });
          } catch (e) {
            return redirect(returnTo, {
              ok: false,
              output: `Error: ${(e as Error).message}`,
            });
          }
        }
        return redirect(returnTo, {
          ok: false,
          output: `No handler for action ${actionId}`,
        });
      }
    }

    return notFound();
  },
});

console.log(`meta hub listening on http://localhost:${server.port}`);
