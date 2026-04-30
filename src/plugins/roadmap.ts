import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ActionDef, ActionRequest, ActionResult, Plugin, Project } from "../types.ts";
import { escape, fileUrl } from "../util/html.ts";
import { readFrontmatter } from "../util/frontmatter.ts";

interface RoadmapPaths {
  root: string;
  scripts: {
    captureClarification?: string;
    captureFeedback?: string;
    nextActions?: string;
    attentionSummary?: string;
    promote?: string;
    buildDashboard?: string;
  };
}

interface FeatureItem {
  slug: string;
  dir: string;
  readme: string;
  id: string;
  title: string;
  status: string;
  stage: string;
  priority: string;
  owner: string;
  blockedBy: string;
  hasArtifact: Record<string, boolean>;
  feedbackOpen: number;
  feedbackTotal: number;
  prototypeCount: number;
}

const ARTIFACT_FILES = [
  "notes.md",
  "user-stories.md",
  "existing-state.md",
  "ux-review.md",
  "architecture.md",
  "architecture-review.md",
  "spec.md",
  "plan.md",
  "implementation-handoff.md",
  "open-questions.md",
];

function roadmapPaths(project: Project): RoadmapPaths | null {
  const override = (project.manifest.roadmap as { dir?: string } | undefined)?.dir;
  const candidates = override ? [override] : ["docs/roadmap"];
  for (const rel of candidates) {
    const root = join(project.path, rel);
    if (existsSync(root) && statSync(root).isDirectory()) {
      const scriptDir = join(project.path, "scripts", "roadmap");
      const actions = (project.manifest.actions ?? {}) as Record<string, string>;
      const resolveScript = (key: string, fallback: string) => {
        const declared = actions[key];
        if (declared) {
          const abs = join(project.path, declared);
          return existsSync(abs) ? abs : undefined;
        }
        const abs = join(scriptDir, fallback);
        return existsSync(abs) ? abs : undefined;
      };
      return {
        root,
        scripts: {
          captureClarification: resolveScript("capture-clarification", "capture-clarification.sh"),
          captureFeedback: resolveScript("capture-feedback", "capture-feedback.sh"),
          nextActions: resolveScript("next-actions", "next-roadmap-actions.sh"),
          attentionSummary: resolveScript("attention-summary", "attention-summary.sh"),
          promote: resolveScript("promote", "promote-ready-item-to-worktree.sh"),
          buildDashboard: resolveScript("build-dashboard", "build-dashboard.sh"),
        },
      };
    }
  }
  return null;
}

function listFeatureDirs(roadmapRoot: string): string[] {
  try {
    return readdirSync(roadmapRoot)
      .map((f) => join(roadmapRoot, f))
      .filter((p) => statSync(p).isDirectory());
  } catch {
    return [];
  }
}

function feedbackCounts(featureDir: string): { open: number; total: number } {
  const dir = join(featureDir, "feedback");
  if (!existsSync(dir)) return { open: 0, total: 0 };
  let open = 0;
  let total = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    total++;
    const fm = readFrontmatter(join(dir, f));
    const status = (fm?.data.status as string) ?? "new";
    if (status !== "handled" && status !== "archived") open++;
  }
  return { open, total };
}

function prototypeCount(featureDir: string): number {
  const dir = join(featureDir, "prototypes");
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".html")).length;
  } catch {
    return 0;
  }
}

function readFeatures(roadmapRoot: string): FeatureItem[] {
  const items: FeatureItem[] = [];
  for (const dir of listFeatureDirs(roadmapRoot)) {
    const readme = join(dir, "README.md");
    if (!existsSync(readme)) continue;
    const fm = readFrontmatter(readme);
    if (!fm) continue;
    const slug = dir.split("/").pop()!;
    const fb = feedbackCounts(dir);
    const hasArtifact: Record<string, boolean> = {};
    for (const file of ARTIFACT_FILES) {
      hasArtifact[file] = existsSync(join(dir, file));
    }
    items.push({
      slug,
      dir,
      readme,
      id: String(fm.data.id ?? "?"),
      title: String(fm.data.title ?? slug),
      status: String(fm.data.status ?? "unknown"),
      stage: String(fm.data.stage ?? "unknown"),
      priority: String(fm.data.priority ?? "unset"),
      owner: String(fm.data.owner ?? "unknown"),
      blockedBy: JSON.stringify(fm.data.blocked_by ?? []),
      hasArtifact,
      feedbackOpen: fb.open,
      feedbackTotal: fb.total,
      prototypeCount: prototypeCount(dir),
    });
  }
  return items.sort((a, b) => {
    const ai = parseInt(a.id, 10);
    const bi = parseInt(b.id, 10);
    if (Number.isFinite(ai) && Number.isFinite(bi)) return ai - bi;
    return a.title.localeCompare(b.title);
  });
}

function parseSection(text: string, heading: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (line === `## ${heading}`) {
      inSection = true;
      continue;
    }
    if (inSection && line.startsWith("## ")) break;
    if (inSection) out.push(line);
  }
  return out.join("\n");
}

function sectionValue(section: string, key: string): string {
  const re = new RegExp(`^- \\*\\*${key}:\\*\\* (.*)$`, "m");
  const m = section.match(re);
  return m ? m[1]!.replace(/`/g, "") : "";
}

function findFeatureSlugByTitle(items: FeatureItem[], title: string): string | null {
  const match = items.find((it) => it.title === title);
  return match?.slug ?? null;
}

function renderNextActions(project: Project, items: FeatureItem[], paths: RoadmapPaths): string {
  const file = join(paths.root, "next-actions.md");
  if (!existsSync(file)) {
    return `<p class="muted">No next-actions.md. Run the selector script.</p>`;
  }
  const text = readFileSync(file, "utf8");

  function card(heading: string, sectionName: string): string {
    const section = parseSection(text, sectionName);
    const item = sectionValue(section, "Item");
    const feature = sectionValue(section, "Feature");
    const action = sectionValue(section, "Action");
    const why = sectionValue(section, "Why");
    const slug = findFeatureSlugByTitle(items, feature);
    const titleHtml = slug
      ? `<a href="/p/${escape(project.slug)}/roadmap/${escape(slug)}">Item ${escape(item)}: ${escape(feature)}</a>`
      : `Item ${escape(item)}: ${escape(feature)}`;

    let actionLinks = "";
    if (slug && action === "review-prototypes") {
      const protoDir = join(paths.root, slug, "prototypes");
      const protoFiles = existsSync(protoDir)
        ? readdirSync(protoDir).filter((f) => f.endsWith(".html")).sort()
        : [];
      if (protoFiles.length > 0) {
        const links = protoFiles
          .map(
            (f) =>
              `<li><a href="/p/${escape(project.slug)}/roadmap/${escape(slug)}/review-prototypes/${escape(encodeURIComponent(f))}">${escape(f.replace(/\.html$/, ""))}</a></li>`,
          )
          .join("");
        actionLinks = `<ul class="action-links">${links}</ul>`;
      }
    } else if (slug && action === "review-architecture") {
      actionLinks = `<ul class="action-links"><li><a href="/p/${escape(project.slug)}/roadmap/${escape(slug)}#architecture">Open architecture review</a></li></ul>`;
    }

    return `
      <div class="panel">
        <h2>${escape(heading)}</h2>
        <p><strong>${titleHtml}</strong></p>
        <p><code>${escape(action)}</code></p>
        <p class="muted">${escape(why)}</p>
        ${actionLinks}
      </div>`;
  }

  return `
    <div class="grid">
      ${card("Next For You", "Next User Item")}
      ${card("Next Agent Item", "Next Agent Item")}
    </div>`;
}

function renderFeatureTable(project: Project, items: FeatureItem[]): string {
  if (items.length === 0) return `<p class="muted">No feature directories.</p>`;
  const rows = items
    .map((it) => {
      const statusClass =
        it.status === "blocked"
          ? "attention"
          : it.status === "deferred"
            ? "muted"
            : "ok";
      const fbBadge =
        it.feedbackOpen > 0
          ? `<span class="attention">${it.feedbackOpen}</span>`
          : `<span class="muted">${it.feedbackTotal}</span>`;
      return `
        <tr>
          <td>${escape(it.id)}</td>
          <td><a href="/p/${escape(project.slug)}/roadmap/${escape(it.slug)}">${escape(it.title)}</a></td>
          <td><code>${escape(it.stage)}</code></td>
          <td><span class="${statusClass}">${escape(it.status)}</span></td>
          <td>${escape(it.owner)}</td>
          <td>${it.prototypeCount}</td>
          <td>${fbBadge}</td>
        </tr>`;
    })
    .join("");
  return `
    <section class="panel wide">
      <h2>Feature Inventory</h2>
      <table>
        <thead>
          <tr>
            <th>ID</th><th>Feature</th><th>Stage</th><th>Status</th><th>Owner</th><th>Protos</th><th>Open feedback</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function renderSummary(items: FeatureItem[]): string {
  const totalPrototypes = items.reduce((s, it) => s + it.prototypeCount, 0);
  const openFeedback = items.reduce((s, it) => s + it.feedbackOpen, 0);
  const blocked = items.filter((it) => it.status === "blocked").length;
  const openQuestions = items.filter((it) => it.hasArtifact["open-questions.md"]).length;
  const readyForBuild = items.filter((it) => it.stage === "ready-for-build-queue").length;

  const card = (label: string, value: number, klass = "") =>
    `<div class="summary-item"><div class="label">${escape(label)}</div><div class="value ${klass}">${value}</div></div>`;

  return `
    <section class="summary">
      ${card("Items", items.length)}
      ${card("Prototypes", totalPrototypes)}
      ${card("Open Feedback", openFeedback, openFeedback > 0 ? "attention" : "ok")}
      ${card("Blocked", blocked, blocked > 0 ? "attention" : "ok")}
      ${card("Open Questions", openQuestions, openQuestions > 0 ? "attention" : "ok")}
      ${card("Ready For Build", readyForBuild, "ok")}
    </section>`;
}

function renderActionForms(project: Project, paths: RoadmapPaths, items: FeatureItem[]): string {
  const itemOptions = items
    .map((it) => `<option value="${escape(it.id)}">${escape(it.id)} — ${escape(it.title)}</option>`)
    .join("");

  const blocks: string[] = [];

  if (paths.scripts.captureClarification) {
    blocks.push(`
      <form class="action-form" method="post" action="/p/${escape(project.slug)}/action/capture-clarification">
        <h3>Capture Clarification</h3>
        <label>Item</label>
        <select name="item-id" required>${itemOptions}</select>
        <label>Raw clarification</label>
        <textarea name="text" required placeholder="Raw user clarification"></textarea>
        <button type="submit">Capture</button>
      </form>`);
  }

  if (paths.scripts.captureFeedback) {
    blocks.push(`
      <form class="action-form" method="post" action="/p/${escape(project.slug)}/action/capture-feedback">
        <h3>Capture Feedback</h3>
        <label>Item</label>
        <select name="item-id" required>${itemOptions}</select>
        <label>Applies to</label>
        <select name="applies-to" required>
          <option value="general">general</option>
          <option value="prototypes">prototypes</option>
          <option value="architecture">architecture</option>
          <option value="spec">spec</option>
          <option value="plan">plan</option>
        </select>
        <label>Raw feedback</label>
        <textarea name="text" required placeholder="Review comment, prototype concern, etc."></textarea>
        <button type="submit">Capture</button>
      </form>`);
  }

  if (blocks.length === 0) return "";
  return `
    <section class="panel wide">
      <h2>Annotate</h2>
      <div class="grid">
        ${blocks.join("")}
      </div>
    </section>`;
}

export function renderFeaturePage(project: Project, slug: string): string | null {
  const paths = roadmapPaths(project);
  if (!paths) return null;
  const dir = join(paths.root, slug);
  if (!existsSync(dir)) return null;
  const readme = join(dir, "README.md");
  const fm = readFrontmatter(readme);
  const title = (fm?.data.title as string) ?? slug;

  const artefactRows = ARTIFACT_FILES.map((f) => {
    const present = existsSync(join(dir, f));
    return `
      <tr>
        <td><code>${escape(f)}</code></td>
        <td>${present ? `<a href="${escape(fileUrl(join(dir, f)))}">open</a>` : `<span class="muted">missing</span>`}</td>
      </tr>`;
  }).join("");

  const protoDir = join(dir, "prototypes");
  const protoFiles = existsSync(protoDir)
    ? readdirSync(protoDir).filter((f) => f.endsWith(".html")).sort()
    : [];
  const hasUxReview = existsSync(join(dir, "ux-review.md"));
  const hasArchitecture = existsSync(join(dir, "architecture.md"));
  const hasArchReview = existsSync(join(dir, "architecture-review.md"));

  function relPath(absPath: string): string {
    return absPath.slice(project.path.length + 1);
  }

  function fileRoute(absPath: string): string {
    return `/p/${project.slug}/files/${relPath(absPath)
      .split("/")
      .map((s) => encodeURIComponent(s))
      .join("/")}`;
  }

  function reviewForm(appliesTo: string, label: string): string {
    if (!paths.scripts.captureFeedback || fm?.data.id === undefined) return "";
    return `
      <form class="action-form" method="post" action="/p/${escape(project.slug)}/action/capture-feedback">
        <h3>${escape(label)}</h3>
        <input type="hidden" name="item-id" value="${escape(String(fm.data.id))}">
        <input type="hidden" name="applies-to" value="${escape(appliesTo)}">
        <label>Feedback (applies to <code>${escape(appliesTo)}</code>)</label>
        <textarea name="text" required placeholder="What works, what fails, which direction to keep, what needs another pass."></textarea>
        <button type="submit">Capture Feedback</button>
      </form>`;
  }

  let activeReview = "";

  if (protoFiles.length > 0 && !hasUxReview) {
    const links = protoFiles
      .map(
        (f) =>
          `<li><a href="/p/${escape(project.slug)}/roadmap/${escape(slug)}/review-prototypes/${escape(encodeURIComponent(f))}">${escape(f.replace(/\.html$/, ""))}</a></li>`,
      )
      .join("");
    activeReview = `
      <section class="panel review-panel">
        <h2>Review: Prototypes</h2>
        <p class="muted">Evaluate against the UX checklist; capture review writes to <code>feedback/</code> with <code>applies_to: prototypes</code>.</p>
        <ul class="action-links">${links}</ul>
      </section>`;
  } else if (hasArchitecture && !hasArchReview) {
    const archPath = join(dir, "architecture.md");
    activeReview = `
      <section class="panel wide review-panel">
        <h2>Review: Architecture</h2>
        <p class="muted">Review the proposed data/runtime shape, what is transient vs persisted, guardrails, and unresolved questions.</p>
        <div class="review-grid">
          <div class="review-frames">
            <div class="prototype-frame">
              <div class="prototype-frame-head">
                <strong>architecture.md</strong>
                <a href="${escape(fileRoute(archPath))}" target="_blank">open in new tab</a>
              </div>
              <iframe src="${escape(fileRoute(archPath))}" loading="lazy"></iframe>
            </div>
          </div>
          <div class="review-form">${reviewForm("architecture", "Capture Architecture Review")}</div>
        </div>
      </section>`;
  }

  let prototypes = "";
  if (protoFiles.length > 0) {
    prototypes = `
      <section class="panel">
        <h2>Prototypes</h2>
        <ul>
          ${protoFiles
            .map(
              (f) =>
                `<li><a href="${escape(fileRoute(join(protoDir, f)))}" target="_blank">${escape(f)}</a> · <a class="muted" href="${escape(fileUrl(join(protoDir, f)))}">file://</a></li>`,
            )
            .join("")}
        </ul>
      </section>`;
  }

  let feedback = "";
  const fbDir = join(dir, "feedback");
  if (existsSync(fbDir)) {
    const files = readdirSync(fbDir).filter((f) => f.endsWith(".md")).sort();
    if (files.length > 0) {
      const rows = files
        .map((f) => {
          const fm2 = readFrontmatter(join(fbDir, f));
          const status = (fm2?.data.status as string) ?? "new";
          const applies = (fm2?.data.applies_to as string) ?? "";
          const klass = status === "handled" || status === "archived" ? "muted" : "attention";
          return `
            <tr>
              <td><a href="${escape(fileUrl(join(fbDir, f)))}">${escape(f)}</a></td>
              <td>${escape(applies)}</td>
              <td><span class="${klass}">${escape(status)}</span></td>
            </tr>`;
        })
        .join("");
      feedback = `
        <section class="panel">
          <h2>Feedback Queue</h2>
          <table>
            <thead><tr><th>File</th><th>Applies to</th><th>Status</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </section>`;
    }
  }

  let actions = "";
  if (paths.scripts.captureFeedback && fm?.data.id !== undefined) {
    actions = `
      <form class="action-form" method="post" action="/p/${escape(project.slug)}/action/capture-feedback">
        <h3>Add Feedback For This Feature</h3>
        <input type="hidden" name="item-id" value="${escape(String(fm.data.id))}">
        <label>Applies to</label>
        <select name="applies-to" required>
          <option value="general">general</option>
          <option value="prototypes">prototypes</option>
          <option value="architecture">architecture</option>
          <option value="spec">spec</option>
          <option value="plan">plan</option>
        </select>
        <label>Raw feedback</label>
        <textarea name="text" required placeholder="Review comment"></textarea>
        <button type="submit">Capture Feedback</button>
      </form>`;
  }

  const front = fm
    ? Object.entries(fm.data)
        .map(([k, v]) => `<tr><td><strong>${escape(k)}</strong></td><td><code>${escape(JSON.stringify(v))}</code></td></tr>`)
        .join("")
    : "";

  return `
    <h1>${escape(title)}</h1>
    <p class="muted"><a href="${escape(fileUrl(dir))}">${escape(dir)}</a></p>

    <section class="panel">
      <h2>Status</h2>
      <table><tbody>${front}</tbody></table>
    </section>

    ${activeReview}

    <section class="panel">
      <h2>Artefact Inventory</h2>
      <table>
        <thead><tr><th>Artefact</th><th></th></tr></thead>
        <tbody>${artefactRows}</tbody>
      </table>
    </section>

    ${prototypes}
    ${feedback}
    ${actions}`;
}

export interface ReviewPrototypesPage {
  title: string;
  featureSlug: string;
  body: string;
}

export function renderReviewPrototypesPage(
  project: Project,
  featureSlug: string,
  protoName: string,
): ReviewPrototypesPage | null {
  const paths = roadmapPaths(project);
  if (!paths) return null;
  const dir = join(paths.root, featureSlug);
  if (!existsSync(dir)) return null;
  const protoDir = join(dir, "prototypes");
  if (!existsSync(protoDir)) return null;
  const files = readdirSync(protoDir).filter((f) => f.endsWith(".html")).sort();
  if (files.length === 0) return null;
  const active = files.includes(protoName) ? protoName : files[0]!;

  const fm = readFrontmatter(join(dir, "README.md"));
  const itemId = fm?.data.id !== undefined ? String(fm.data.id) : "";
  const title = (fm?.data.title as string) ?? featureSlug;

  const fileRoute = (rel: string) =>
    `/p/${project.slug}/files/${rel
      .split("/")
      .map((s) => encodeURIComponent(s))
      .join("/")}`;

  const reviewBase = `/p/${project.slug}/roadmap/${featureSlug}/review-prototypes`;

  const tabs = files
    .map((f) => {
      const cls = f === active ? "tab active" : "tab";
      return `<a class="${cls}" href="${escape(reviewBase)}/${escape(encodeURIComponent(f))}">${escape(f.replace(/\.html$/, ""))}</a>`;
    })
    .join("");

  const protoRel = `${paths.root.slice(project.path.length + 1)}/${featureSlug}/prototypes/${active}`;
  const protoUrl = fileRoute(protoRel);

  const form = paths.scripts.captureFeedback && itemId
    ? `
      <form class="action-form" method="post" action="/p/${escape(project.slug)}/action/capture-feedback?return=${encodeURIComponent(`${reviewBase}/${encodeURIComponent(active)}`)}">
        <h3>Prototype Review</h3>
        <input type="hidden" name="item-id" value="${escape(itemId)}">
        <input type="hidden" name="applies-to" value="prototypes">
        <p class="muted">Reviewing <code>${escape(active)}</code>. Feedback writes to <code>feedback/</code> with <code>applies_to: prototypes</code> against item ${escape(itemId)}.</p>
        <label>UX Checklist Notes</label>
        <textarea name="text" required placeholder="Goal clarity, progressive disclosure, information hierarchy, state legibility, action locality, reversibility, empty/error states, performance feel, ergonomics, consistency. What works, what fails, which direction to keep."></textarea>
        <button type="submit">Capture Feedback</button>
      </form>`
    : `<p class="muted">No capture-feedback script available.</p>`;

  const body = `
    <h1>Review prototypes — ${escape(title)}</h1>
    <p class="muted"><a href="/p/${escape(project.slug)}/roadmap/${escape(featureSlug)}">← back to feature</a></p>
    <div class="tabs">${tabs}</div>
    <div class="review-grid">
      <div class="review-frames">
        <div class="prototype-frame">
          <div class="prototype-frame-head">
            <strong>${escape(active)}</strong>
            <a href="${escape(protoUrl)}" target="_blank">open in new tab</a>
          </div>
          <iframe src="${escape(protoUrl)}" loading="lazy"></iframe>
        </div>
      </div>
      <div class="review-form">${form}</div>
    </div>`;

  return { title: `Review ${active} — ${title}`, featureSlug, body };
}

async function runScript(cmd: string[], cwd: string): Promise<{ ok: boolean; output: string }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { ok: code === 0, output: `${stdout}${stderr ? `\n${stderr}` : ""}` };
}

export const roadmapPlugin: Plugin = {
  id: "roadmap",
  label: "Roadmap",

  detect(project) {
    return roadmapPaths(project) !== null;
  },

  render(ctx) {
    const paths = roadmapPaths(ctx.project);
    if (!paths) return `<p class="muted">No roadmap directory.</p>`;
    const items = readFeatures(paths.root);
    return `
      ${renderSummary(items)}
      ${renderNextActions(ctx.project, items, paths)}
      ${renderFeatureTable(ctx.project, items)}
      ${renderActionForms(ctx.project, paths, items)}`;
  },

  summary(ctx) {
    const paths = roadmapPaths(ctx.project);
    if (!paths) return "";
    const items = readFeatures(paths.root);
    const open = items.reduce((s, it) => s + it.feedbackOpen, 0);
    const blocked = items.filter((it) => it.status === "blocked").length;
    const parts = [`${items.length} item${items.length === 1 ? "" : "s"}`];
    if (open > 0) parts.push(`${open} open feedback`);
    if (blocked > 0) parts.push(`${blocked} blocked`);
    return parts.join(", ");
  },

  actions(project): ActionDef[] {
    const paths = roadmapPaths(project);
    if (!paths) return [];
    const out: ActionDef[] = [];
    if (paths.scripts.captureClarification) {
      out.push({
        id: "capture-clarification",
        label: "Capture Clarification",
        fields: [
          { name: "item-id", label: "Item ID", type: "text", required: true },
          { name: "text", label: "Raw clarification", type: "textarea", required: true },
        ],
      });
    }
    if (paths.scripts.captureFeedback) {
      out.push({
        id: "capture-feedback",
        label: "Capture Feedback",
        fields: [
          { name: "item-id", label: "Item ID", type: "text", required: true },
          { name: "applies-to", label: "Applies to", type: "text", required: true },
          { name: "text", label: "Feedback", type: "textarea", required: true },
        ],
      });
    }
    return out;
  },

  async handleAction(req: ActionRequest): Promise<ActionResult> {
    const paths = roadmapPaths(req.project);
    if (!paths) return { ok: false, output: "No roadmap directory" };
    const cwd = req.project.path;

    if (req.action === "capture-clarification" && paths.scripts.captureClarification) {
      const itemId = req.values["item-id"];
      const text = req.values["text"];
      if (!itemId || !text) return { ok: false, output: "Missing fields" };
      return runScript([paths.scripts.captureClarification, itemId, text], cwd);
    }

    if (req.action === "capture-feedback" && paths.scripts.captureFeedback) {
      const itemId = req.values["item-id"];
      const appliesTo = req.values["applies-to"];
      const text = req.values["text"];
      if (!itemId || !appliesTo || !text) return { ok: false, output: "Missing fields" };
      return runScript([paths.scripts.captureFeedback, itemId, appliesTo, text], cwd);
    }

    return { ok: false, output: `Unknown action ${req.action}` };
  },
};
