import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ActionDef, ActionRequest, ActionResult, Plugin, Project } from "../types.ts";
import { escape, fileUrl } from "../util/html.ts";
import { readFrontmatter } from "../util/frontmatter.ts";
import { renderMarkdown } from "../util/markdown.ts";
import { parseConcerns, parseOpenQuestions } from "../util/atomic-items.ts";

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

interface ArchitectureDiagram {
  index: number;
  title: string;
  source: string;
  kinds: string[];
}

interface ArchitectureDiagramInventory {
  diagrams: ArchitectureDiagram[];
  coverage: Record<string, boolean>;
}

interface PromotionState {
  branch: string;
  worktree: string;
  branchExists: boolean;
  worktreeExists: boolean;
  buildPlans: string[];
  promoted: boolean;
}

interface BuildWorktree {
  name: string;
  path: string;
  branch: string;
  head: string;
  featureId: string;
  featureSlug: string;
  featureTitle: string;
  buildPlans: string[];
  nextAction: string;
  workItemPresent: boolean;
  partialWorkPresent: boolean;
  testsFailurePresent: boolean;
  critiqueCount: number;
  inboxCount: number;
  dirtyCount: number;
  openBuildScript: string | null;
  isReady: boolean;
  readyBlockers: string[];
  lastReviewSha: string | null;
  headSha: string;
  mergeBase: string | null;
  readyForUserPath: string | null;
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

const ARCHITECTURE_DIAGRAM_KINDS = [
  {
    id: "data-model",
    label: "Data model",
    hint: "Persisted or runtime data shape changes.",
    pattern: /\b(data|model|schema|persisted?|document|runtime state|state shape)\b/i,
  },
  {
    id: "pipeline",
    label: "Pipeline / flow",
    hint: "Playback, rendering, synchronization, import/export, or processing paths.",
    pattern: /\b(pipeline|flow|playback|render(?:ing)?|sync(?:hronization)?|import|export|process(?:ing)?|engine)\b/i,
  },
  {
    id: "responsibility",
    label: "Responsibilities",
    hint: "Component, module, ownership, or boundary changes.",
    pattern: /\b(component|module|boundary|ownership|responsibilit(?:y|ies)|service|controller|view)\b/i,
  },
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

function headingBefore(text: string, index: number): string | null {
  const before = text.slice(0, index).split("\n").slice(-8).reverse();
  const heading = before.find((line) => /^#{2,6}\s+\S/.test(line.trim()));
  return heading ? heading.replace(/^#{2,6}\s+/, "").trim() : null;
}

function architectureDiagramInventory(featureDir: string): ArchitectureDiagramInventory {
  const file = join(featureDir, "architecture.md");
  const coverage = Object.fromEntries(ARCHITECTURE_DIAGRAM_KINDS.map((kind) => [kind.id, false])) as Record<string, boolean>;
  if (!existsSync(file)) return { diagrams: [], coverage };

  const text = readFileSync(file, "utf8");
  const diagrams: ArchitectureDiagram[] = [];
  const re = /```mermaid\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const source = match[1]!.trim();
    const title = headingBefore(text, match.index) ?? `Diagram ${diagrams.length + 1}`;
    const haystack = `${title}\n${source}`;
    const kinds = ARCHITECTURE_DIAGRAM_KINDS
      .filter((kind) => kind.pattern.test(haystack))
      .map((kind) => kind.id);
    for (const kind of kinds) coverage[kind] = true;
    diagrams.push({ index: diagrams.length + 1, title, source, kinds });
  }

  return { diagrams, coverage };
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

function isReadyForPromotion(item: FeatureItem): boolean {
  return (
    item.stage === "ready-for-build-queue" ||
    item.stage === "ready-for-build" ||
    item.status === "ready-for-build"
  );
}

function promotionReadiness(item: FeatureItem): { ready: boolean; missing: string[] } {
  const required = ["implementation-handoff.md", "spec.md", "plan.md"];
  const missing = required.filter((file) => !item.hasArtifact[file]);
  return { ready: missing.length === 0 && isReadyForPromotion(item), missing };
}

function branchExists(project: Project, branch: string): boolean {
  try {
    execFileSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
      cwd: project.path,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function gitOutput(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function countMarkdownFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter((file) => file.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

function readNextAction(worktreePath: string): string {
  const file = join(worktreePath, ".claude", "state", "next-action.md");
  if (!existsSync(file)) return "unknown";
  const text = readFileSync(file, "utf8");
  const match = text.match(/^## Action:\s*(.+)$/m);
  return match ? match[1]!.trim() : "unknown";
}

function promotionState(project: Project, item: FeatureItem): PromotionState {
  const branch = `auto/roadmap-${item.id}-${item.slug}`;
  const worktree = join(project.path, ".worktrees", `roadmap-${item.id}-${item.slug}`);
  const worktreeExists = existsSync(worktree);
  const planDir = join(worktree, "docs", "plans");
  const buildPlans = worktreeExists && existsSync(planDir)
    ? readdirSync(planDir)
        .filter((file) => file.endsWith(".md") && file.includes(`roadmap-${item.id}-${item.slug}`))
        .sort()
    : [];
  const branchFound = branchExists(project, branch);

  return {
    branch,
    worktree,
    branchExists: branchFound,
    worktreeExists,
    buildPlans,
    promoted: branchFound || worktreeExists || buildPlans.length > 0,
  };
}

function listBuildWorktrees(project: Project, items: FeatureItem[]): BuildWorktree[] {
  const root = join(project.path, ".worktrees");
  if (!existsSync(root)) return [];

  const byIdAndSlug = new Map(items.map((item) => [`${item.id}:${item.slug}`, item]));
  const out: BuildWorktree[] = [];

  for (const name of readdirSync(root).sort()) {
    const match = name.match(/^roadmap-([0-9]+)-(.+)$/);
    if (!match) continue;

    const path = join(root, name);
    if (!existsSync(path) || !statSync(path).isDirectory()) continue;

    const featureId = match[1]!;
    const featureSlug = match[2]!;
    const item = byIdAndSlug.get(`${featureId}:${featureSlug}`);
    const planDir = join(path, "docs", "plans");
    const buildPlans = existsSync(planDir)
      ? readdirSync(planDir)
          .filter((file) => file.endsWith(".md") && file.includes(`roadmap-${featureId}-${featureSlug}`))
          .sort()
      : [];

    const openBuildPath = join(path, "scripts", "open-latest-build.sh");
    const stateDir = join(path, ".claude", "state");
    const workItemPresent = existsSync(join(stateDir, "work-item.md"));
    const partialWorkPresent = existsSync(join(stateDir, "partial-work.md"));
    const testsFailurePresent = existsSync(join(stateDir, "last-tests-failure.md"));
    const critiqueCount = countMarkdownFiles(join(stateDir, "review-queue"));
    const inboxCount = countMarkdownFiles(join(stateDir, "inbox"));
    const dirtyCount = gitOutput(path, ["status", "--porcelain"]).split("\n").filter(Boolean).length;

    const headSha = gitOutput(path, ["rev-parse", "HEAD"]) || "";
    const lastReviewShaRaw = existsSync(join(stateDir, "last-review-sha"))
      ? readFileSync(join(stateDir, "last-review-sha"), "utf8").trim()
      : "";
    const lastReviewSha = lastReviewShaRaw || null;
    const lastTestsShaRaw = existsSync(join(stateDir, "last-tests-sha"))
      ? readFileSync(join(stateDir, "last-tests-sha"), "utf8").trim()
      : "";
    const lastTestsSha = lastTestsShaRaw || null;

    const mergeBaseCmd = gitOutput(path, ["merge-base", "HEAD", "origin/main"])
      || gitOutput(path, ["merge-base", "HEAD", "main"])
      || "";
    const mergeBase = mergeBaseCmd || null;

    const readyBlockers: string[] = [];
    if (testsFailurePresent) readyBlockers.push("tests failure outstanding");
    if (workItemPresent) readyBlockers.push("work item in progress");
    if (partialWorkPresent) readyBlockers.push("partial work outstanding");
    if (critiqueCount > 0) readyBlockers.push(`${critiqueCount} open critique${critiqueCount === 1 ? "" : "s"}`);
    if (inboxCount > 0) readyBlockers.push(`${inboxCount} open inbox item${inboxCount === 1 ? "" : "s"}`);
    if (!lastTestsSha) {
      readyBlockers.push("tests not verified at any commit (no last-tests-sha)");
    } else if (lastTestsSha !== headSha) {
      readyBlockers.push(`last-tests-sha (${lastTestsSha.slice(0, 7)}) != HEAD (${headSha.slice(0, 7)})`);
    }
    if (!lastReviewSha) {
      readyBlockers.push("HEAD has not been adversarially reviewed (no last-review-sha)");
    } else if (lastReviewSha !== headSha) {
      readyBlockers.push(`last-review-sha (${lastReviewSha.slice(0, 7)}) != HEAD (${headSha.slice(0, 7)})`);
    }
    const isReady = readyBlockers.length === 0 && headSha !== "";

    const readyForUserPath = existsSync(join(stateDir, "ready-for-user.md"))
      ? join(stateDir, "ready-for-user.md")
      : null;

    out.push({
      name,
      path,
      branch: gitOutput(path, ["branch", "--show-current"]) || `auto/roadmap-${featureId}-${featureSlug}`,
      head: gitOutput(path, ["rev-parse", "--short", "HEAD"]) || "unknown",
      featureId,
      featureSlug,
      featureTitle: item?.title ?? featureSlug,
      buildPlans,
      nextAction: readNextAction(path),
      workItemPresent,
      partialWorkPresent,
      testsFailurePresent,
      critiqueCount,
      inboxCount,
      dirtyCount,
      openBuildScript: existsSync(openBuildPath) ? openBuildPath : null,
      isReady,
      readyBlockers,
      lastReviewSha,
      headSha,
      mergeBase,
      readyForUserPath,
    });
  }

  return out;
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

function renderPromotionPanel(project: Project, items: FeatureItem[], paths: RoadmapPaths): string {
  const readyItems = items
    .filter(isReadyForPromotion)
    .map((item) => ({ item, state: promotionState(project, item) }));
  if (readyItems.length === 0) {
    return `
      <section class="panel wide promotion-panel">
        <h2>Promotion Queue</h2>
        <p class="muted">No roadmap items are currently marked <code>ready-for-build-queue</code>.</p>
      </section>`;
  }

  const cards = readyItems
    .map(({ item: it, state }) => {
      const readiness = promotionReadiness(it);
      const sourcePath = `docs/roadmap/${it.slug}/`;
      const artifactLinks = ["implementation-handoff.md", "spec.md", "plan.md", "architecture.md", "architecture-review.md"]
        .filter((file) => it.hasArtifact[file])
        .map((file) => {
          const abs = join(it.dir, file);
          return `<li><a href="${escape(fileUrl(abs))}">${escape(file)}</a></li>`;
        })
        .join("");

      const missing = readiness.missing.length > 0
        ? `<p class="attention">Missing required artifact(s): ${escape(readiness.missing.join(", "))}</p>`
        : `<p class="ok">Required handoff artifacts are present.</p>`;

      const command = `scripts/roadmap/promote-ready-item-to-worktree.sh ${it.id}`;
      const buildPlanLinks = state.buildPlans
        .map((file) => {
          const abs = join(state.worktree, "docs", "plans", file);
          return `<li><a href="${escape(fileUrl(abs))}">${escape(file)}</a></li>`;
        })
        .join("");

      const promoteControl = state.promoted
        ? `
          <div class="promotion-state ok">Promoted</div>
          <dl class="compact-list">
            <dt>Branch</dt><dd><code>${escape(state.branch)}</code>${state.branchExists ? "" : ` <span class="attention">not found</span>`}</dd>
            <dt>Worktree</dt><dd><a href="${escape(fileUrl(state.worktree))}">${escape(state.worktree)}</a>${state.worktreeExists ? "" : ` <span class="attention">not found</span>`}</dd>
          </dl>
          ${buildPlanLinks ? `<h4>Build Plan</h4><ul>${buildPlanLinks}</ul>` : `<p class="muted">No generated build plan found in the promoted worktree.</p>`}`
        : paths.scripts.promote && readiness.ready
          ? `
          <form class="inline-action-form" method="post" action="/p/${escape(project.slug)}/action/promote-ready-item">
            <input type="hidden" name="item-id" value="${escape(it.id)}">
            <button type="submit">Promote To Build Worktree</button>
          </form>`
          : `<code>${escape(command)}</code>`;

      return `
        <article class="promotion-card ${state.promoted ? "promoted" : "ready"}">
          <div>
            <h3><a href="/p/${escape(project.slug)}/roadmap/${escape(it.slug)}">Item ${escape(it.id)}: ${escape(it.title)}</a></h3>
            <p class="muted"><code>${escape(sourcePath)}</code></p>
            <p><span class="badge">${escape(it.stage)}</span> <span class="badge">${escape(it.status)}</span></p>
            ${missing}
          </div>
          <div>
            <h4>Authoritative Inputs</h4>
            <ul>${artifactLinks || `<li class="muted">No build artifacts found.</li>`}</ul>
          </div>
          <div class="promotion-action">
            <h4>Promotion</h4>
            ${promoteControl}
            <p class="muted">Promotion creates the implementation bridge; builders should consume the handoff before deeper artifacts.</p>
          </div>
        </article>`;
    })
    .join("");

  return `
    <section class="panel wide promotion-panel">
      <h2>Promotion Queue</h2>
      <p class="muted">Roadmap items with completed PM artifacts, split between promotable items and items already handed to the implementation loop.</p>
      <div class="promotion-list">${cards}</div>
    </section>`;
}

function renderBuildWorktreesPanel(project: Project, items: FeatureItem[]): string {
  const worktrees = listBuildWorktrees(project, items);
  if (worktrees.length === 0) {
    return `
      <section class="panel wide build-worktrees-panel">
        <h2>Implementation Worktrees</h2>
        <p class="muted">No promoted roadmap implementation worktrees were found.</p>
      </section>`;
  }

  const rows = worktrees
    .map((wt) => {
      const planLinks = wt.buildPlans
        .map((file) => `<a href="${escape(fileUrl(join(wt.path, "docs", "plans", file)))}">${escape(file)}</a>`)
        .join("<br>");
      const actionClass =
        wt.nextAction === "verify-tests" || wt.nextAction === "fix-critique" || wt.nextAction === "fix-tests"
          ? "attention"
          : wt.nextAction === "execute-work-item" || wt.nextAction === "promote-plan-task-to-work-item"
            ? "ok"
            : "muted";
      const counters = [
        wt.workItemPresent ? `<span class="badge active">work item</span>` : "",
        wt.critiqueCount > 0 ? `<span class="badge attention-badge">${wt.critiqueCount} critique${wt.critiqueCount === 1 ? "" : "s"}</span>` : "",
        wt.inboxCount > 0 ? `<span class="badge attention-badge">${wt.inboxCount} inbox</span>` : "",
        wt.dirtyCount > 0 ? `<span class="badge attention-badge">${wt.dirtyCount} dirty</span>` : "",
      ].filter(Boolean).join(" ");

      const openBuildButton = wt.openBuildScript
        ? `<form class="inline-action-form" method="post" action="/p/${escape(project.slug)}/action/open-build">
             <input type="hidden" name="worktree" value="${escape(wt.name)}">
             <button type="submit" title="Run scripts/open-latest-build.sh in this worktree">Open build</button>
           </form>`
        : `<span class="muted">no script</span>`;

      const readyCell = wt.isReady
        ? `<span class="badge ready">READY</span>` +
          (wt.readyForUserPath
            ? ` <a href="${escape(fileUrl(wt.readyForUserPath))}">summary</a>`
            : "") +
          (wt.mergeBase
            ? `<div class="muted">diff <code>${escape(wt.mergeBase.slice(0, 7))}..${escape(wt.headSha.slice(0, 7))}</code></div>`
            : "")
        : `<span class="muted attention" title="${escape(wt.readyBlockers.join("; "))}">${wt.readyBlockers.length} blocker${wt.readyBlockers.length === 1 ? "" : "s"}</span>`;

      return `
        <tr${wt.isReady ? ' class="ready-row"' : ""}>
          <td>
            <a href="/p/${escape(project.slug)}/roadmap/${escape(wt.featureSlug)}">Item ${escape(wt.featureId)}: ${escape(wt.featureTitle)}</a>
            <div class="muted"><code>${escape(wt.name)}</code></div>
          </td>
          <td><code>${escape(wt.branch)}</code><br><span class="muted">${escape(wt.head)}</span></td>
          <td><span class="${actionClass}"><code>${escape(wt.nextAction)}</code></span><div>${counters}</div></td>
          <td>${readyCell}</td>
          <td><a href="${escape(fileUrl(wt.path))}">${escape(wt.path)}</a></td>
          <td>${planLinks || `<span class="muted">none</span>`}</td>
          <td>${openBuildButton}</td>
        </tr>`;
    })
    .join("");

  const readyCount = worktrees.filter((wt) => wt.isReady).length;

  return `
    <section class="panel wide build-worktrees-panel">
      <h2>Implementation Worktrees ${readyCount > 0 ? `<span class="badge ready">${readyCount} ready</span>` : ""}</h2>
      <p class="muted">Promoted roadmap features currently handed to the implementation behaviour-tree loop. <strong>Ready</strong> means tests pass at HEAD, no open critiques, no work-item / partial-work / inbox items, and <code>last-review-sha == HEAD</code> — i.e., the latest commit has been adversarially reviewed.</p>
      <table>
        <thead>
          <tr><th>Feature</th><th>Branch</th><th>BT action</th><th>Ready</th><th>Worktree</th><th>Build plan</th><th>Build</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
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

interface QueueItem {
  kind:
    | "merge-ready"
    | "review-concerns"
    | "answer-open-questions"
    | "review-prototypes"
    | "review-architecture"
    | "clarify-feature"
    | "ready-to-promote";
  priority: number;
  featureId: string;
  featureSlug: string;
  featureTitle: string;
  context: string;
  href: string;
  // Optional atomic-item scoping: when set, this queue entry refers to a
  // single concern / question / prototype / etc. inside the feature's
  // artefact, not the whole file.
  subId?: string;
  subTitle?: string;
  subBody?: string;
}

const QUEUE_KIND_LABEL: Record<QueueItem["kind"], string> = {
  "merge-ready": "Merge",
  "review-concerns": "Review concerns",
  "answer-open-questions": "Answer open questions",
  "review-prototypes": "Review prototypes",
  "review-architecture": "Review architecture",
  "clarify-feature": "Clarify",
  "ready-to-promote": "Promote",
};

const QUEUE_KIND_PRIORITY: Record<QueueItem["kind"], number> = {
  "merge-ready": 1,
  "review-concerns": 2,
  "answer-open-questions": 3,
  "review-prototypes": 4,
  "review-architecture": 5,
  "clarify-feature": 6,
  "ready-to-promote": 7,
};

function reviewVerdictNeedsRework(featureDir: string, file: string): boolean {
  const fm = readFrontmatter(join(featureDir, file));
  if (!fm) return false;
  const verdict = (fm.data.verdict as string) ?? "";
  return verdict === "needs-rework" || verdict === "rejected";
}

function concernsOpen(featureDir: string): boolean {
  const fm = readFrontmatter(join(featureDir, "concerns.md"));
  if (!fm) return false;
  const status = (fm.data.status as string) ?? "open";
  return status !== "resolved" && status !== "archived";
}

function computeActionQueue(
  project: Project,
  items: FeatureItem[],
  worktrees: BuildWorktree[],
): QueueItem[] {
  const queue: QueueItem[] = [];

  for (const wt of worktrees) {
    if (wt.isReady) {
      queue.push({
        kind: "merge-ready",
        priority: QUEUE_KIND_PRIORITY["merge-ready"],
        featureId: wt.featureId,
        featureSlug: wt.featureSlug,
        featureTitle: wt.featureTitle,
        context: `Worktree ${wt.name} is fully reviewed and ready. ${wt.mergeBase ? `Diff: ${wt.mergeBase.slice(0, 7)}..${wt.headSha.slice(0, 7)}.` : ""}`,
        href: `/p/${project.slug}/roadmap/${wt.featureSlug}`,
      });
    }
  }

  for (const it of items) {
    if (it.status === "deferred") continue;

    if (concernsOpen(it.dir)) {
      const concernsPath = join(it.dir, "concerns.md");
      const concerns = existsSync(concernsPath)
        ? parseConcerns(readFileSync(concernsPath, "utf8"))
        : [];
      if (concerns.length > 0) {
        for (const c of concerns) {
          queue.push({
            kind: "review-concerns",
            priority: QUEUE_KIND_PRIORITY["review-concerns"],
            featureId: it.id,
            featureSlug: it.slug,
            featureTitle: it.title,
            context: `Concern ${c.id}: ${c.title}`,
            href: `/p/${project.slug}/roadmap/${it.slug}`,
            subId: c.id,
            subTitle: c.title,
            subBody: c.body,
          });
        }
      } else {
        queue.push({
          kind: "review-concerns",
          priority: QUEUE_KIND_PRIORITY["review-concerns"],
          featureId: it.id,
          featureSlug: it.slug,
          featureTitle: it.title,
          context: "concerns.md is open. Decide and resolve.",
          href: `/p/${project.slug}/roadmap/${it.slug}`,
        });
      }
      continue;
    }

    if (it.status === "blocked" || it.hasArtifact["open-questions.md"]) {
      const oqPath = join(it.dir, "open-questions.md");
      const questions = it.hasArtifact["open-questions.md"] && existsSync(oqPath)
        ? parseOpenQuestions(readFileSync(oqPath, "utf8"))
        : [];
      if (questions.length > 0) {
        for (const q of questions) {
          queue.push({
            kind: "answer-open-questions",
            priority: QUEUE_KIND_PRIORITY["answer-open-questions"],
            featureId: it.id,
            featureSlug: it.slug,
            featureTitle: it.title,
            context: `Question ${q.id}: ${q.title}`,
            href: `/p/${project.slug}/roadmap/${it.slug}`,
            subId: q.id,
            subTitle: q.title,
            subBody: q.body,
          });
        }
      } else {
        queue.push({
          kind: "answer-open-questions",
          priority: QUEUE_KIND_PRIORITY["answer-open-questions"],
          featureId: it.id,
          featureSlug: it.slug,
          featureTitle: it.title,
          context: it.hasArtifact["open-questions.md"]
            ? "open-questions.md awaits your answer."
            : `Status: blocked.`,
          href: `/p/${project.slug}/roadmap/${it.slug}`,
        });
      }
      continue;
    }

    if (
      it.prototypeCount > 0 &&
      (!it.hasArtifact["ux-review.md"] || reviewVerdictNeedsRework(it.dir, "ux-review.md"))
    ) {
      queue.push({
        kind: "review-prototypes",
        priority: QUEUE_KIND_PRIORITY["review-prototypes"],
        featureId: it.id,
        featureSlug: it.slug,
        featureTitle: it.title,
        context: it.hasArtifact["ux-review.md"]
          ? `ux-review.md verdict requested rework.`
          : `${it.prototypeCount} prototype${it.prototypeCount === 1 ? "" : "s"} waiting for UX review.`,
        href: `/p/${project.slug}/roadmap/${it.slug}`,
      });
      continue;
    }

    if (
      it.hasArtifact["architecture.md"] &&
      (!it.hasArtifact["architecture-review.md"] || reviewVerdictNeedsRework(it.dir, "architecture-review.md"))
    ) {
      queue.push({
        kind: "review-architecture",
        priority: QUEUE_KIND_PRIORITY["review-architecture"],
        featureId: it.id,
        featureSlug: it.slug,
        featureTitle: it.title,
        context: it.hasArtifact["architecture-review.md"]
          ? `architecture-review.md verdict requested rework.`
          : `architecture.md is written; needs your review before spec.`,
        href: `/p/${project.slug}/roadmap/${it.slug}`,
      });
      continue;
    }

    if (!it.hasArtifact["notes.md"]) {
      queue.push({
        kind: "clarify-feature",
        priority: QUEUE_KIND_PRIORITY["clarify-feature"],
        featureId: it.id,
        featureSlug: it.slug,
        featureTitle: it.title,
        context: "No notes.md yet. Capture a brief clarification.",
        href: `/p/${project.slug}/roadmap/${it.slug}`,
      });
      continue;
    }
  }

  for (const it of items) {
    if (it.stage === "ready-for-build-queue" && !worktrees.some((wt) => wt.featureSlug === it.slug)) {
      queue.push({
        kind: "ready-to-promote",
        priority: QUEUE_KIND_PRIORITY["ready-to-promote"],
        featureId: it.id,
        featureSlug: it.slug,
        featureTitle: it.title,
        context: "All PM artifacts present. Promote to a build worktree when ready.",
        href: `/p/${project.slug}/roadmap/${it.slug}`,
      });
    }
  }

  return queue.sort((a, b) => a.priority - b.priority || Number(a.featureId) - Number(b.featureId));
}

export function buildActionQueue(project: Project): QueueItem[] {
  const paths = roadmapPaths(project);
  if (!paths) return [];
  const items = readFeatures(paths.root);
  const worktrees = listBuildWorktrees(project, items);
  return computeActionQueue(project, items, worktrees);
}

function findFeatureDir(project: Project, slug: string): string | null {
  const paths = roadmapPaths(project);
  if (!paths) return null;
  const dir = join(paths.root, slug);
  return existsSync(dir) ? dir : null;
}

function readFileSafely(path: string): string {
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

const FRONTMATTER_DISPLAY_KEYS = new Set([
  "verdict",
  "redirect_to",
  "selected_prototype",
  "applies_to",
  "raised_during",
  "status",
]);

function artefactBlock(label: string, content: string, openHref: string | null): string {
  if (!content.trim()) return `<p class="muted">${escape(label)} is empty or missing.</p>`;
  const linkHtml = openHref ? `<a href="${escape(openHref)}" target="_blank">open in new tab</a>` : "";

  let bodyHtml: string;
  let metaChips = "";
  try {
    const rendered = renderMarkdown(content);
    bodyHtml = rendered.html;
    const chips: string[] = [];
    for (const [k, v] of Object.entries(rendered.frontmatter)) {
      if (!FRONTMATTER_DISPLAY_KEYS.has(k)) continue;
      const val = typeof v === "string" ? v : JSON.stringify(v);
      if (!val || val === "[]" || val === "null") continue;
      chips.push(`<span class="meta-chip"><strong>${escape(k)}</strong> ${escape(val)}</span>`);
    }
    if (chips.length > 0) metaChips = `<div class="meta-chips">${chips.join("")}</div>`;
  } catch {
    bodyHtml = `<pre class="triage-artefact-body-raw">${escape(content)}</pre>`;
  }

  return `
    <div class="triage-artefact">
      <div class="triage-artefact-head"><strong>${escape(label)}</strong>${linkHtml}</div>
      ${metaChips}
      <div class="triage-artefact-body markdown-body">${bodyHtml}</div>
    </div>`;
}

function captureFeedbackForm(
  project: Project,
  itemId: string,
  appliesTo: string,
  label: string,
  placeholder: string,
  returnTo: string,
  buttonLabel: string,
  prefill: string = "",
): string {
  return `
    <form class="triage-form" method="post" action="/p/${escape(project.slug)}/action/capture-feedback?return=${encodeURIComponent(returnTo)}">
      <input type="hidden" name="item-id" value="${escape(itemId)}">
      <input type="hidden" name="applies-to" value="${escape(appliesTo)}">
      <label>${escape(label)}</label>
      <textarea name="text" required placeholder="${escape(placeholder)}" autofocus>${escape(prefill)}</textarea>
      <div class="triage-form-actions">
        <button type="submit">${escape(buttonLabel)}</button>
      </div>
    </form>`;
}

function renderTriageCardBody(
  project: Project,
  current: QueueItem,
  returnTo: string,
): string {
  const dir = findFeatureDir(project, current.featureSlug);
  if (!dir) return `<p class="attention">Feature directory not found.</p>`;
  const featureFileBase = `/p/${project.slug}/files/docs/roadmap/${current.featureSlug}`;
  const itemId = current.featureId;

  switch (current.kind) {
    case "review-concerns": {
      if (current.subId && current.subBody !== undefined) {
        const label = `Concern ${current.subId}: ${current.subTitle ?? ""}`;
        return `
          ${artefactBlock(label, current.subBody, `${featureFileBase}/concerns.md`)}
          <p class="muted">One concern at a time. Decide accepted / open question / non-blocking + reasoning. Captured as feedback with <code>applies_to: concerns</code>; the PM-assistant updates <code>concerns.md</code> on next heartbeat.</p>
          ${captureFeedbackForm(
            project,
            itemId,
            "concerns",
            `Decision for concern ${current.subId}`,
            `Accepted because… / Open question — needs user input on … / Non-blocking; address in follow-up.`,
            returnTo,
            "Capture decision",
            `Concern ${current.subId} (${current.subTitle ?? ""}):\n`,
          )}`;
      }
      const concerns = readFileSafely(join(dir, "concerns.md"));
      return `
        ${artefactBlock("concerns.md", concerns, `${featureFileBase}/concerns.md`)}
        ${captureFeedbackForm(project, itemId, "concerns", "Decision", "Accepted / open question / non-blocking + reasoning.", returnTo, "Capture decision")}`;
    }

    case "answer-open-questions": {
      if (current.subId && current.subBody !== undefined) {
        const label = `Question ${current.subId}: ${current.subTitle ?? ""}`;
        return `
          ${artefactBlock(label, current.subBody, `${featureFileBase}/open-questions.md`)}
          <p class="muted">One question at a time. Captured as feedback with <code>applies_to: open-questions</code>; the PM-assistant incorporates it into the relevant artefact (<code>architecture.md</code>, <code>spec.md</code>, etc.) on next heartbeat.</p>
          ${captureFeedbackForm(
            project,
            itemId,
            "open-questions",
            `Answer to question ${current.subId}`,
            `Choose one of the listed options, or write a different answer with reasoning.`,
            returnTo,
            "Capture answer",
            `Question ${current.subId} (${current.subTitle ?? ""}):\n`,
          )}`;
      }
      const oq = readFileSafely(join(dir, "open-questions.md"));
      return `
        ${artefactBlock("open-questions.md", oq, `${featureFileBase}/open-questions.md`)}
        ${captureFeedbackForm(project, itemId, "open-questions", "Your answer", "Yes/no/option choice + reasoning.", returnTo, "Capture answer")}`;
    }

    case "review-prototypes": {
      const protoDir = join(dir, "prototypes");
      const protoFiles = existsSync(protoDir)
        ? readdirSync(protoDir).filter((f) => f.endsWith(".html")).sort()
        : [];
      const tabs = protoFiles
        .map(
          (f, idx) =>
            `<a class="${idx === 0 ? "tab active" : "tab"}" href="/p/${escape(project.slug)}/roadmap/${escape(current.featureSlug)}/review-prototypes/${escape(encodeURIComponent(f))}">${escape(f.replace(/\.html$/, ""))}</a>`,
        )
        .join("");
      const first = protoFiles[0];
      const iframe = first
        ? `<iframe class="triage-iframe" src="/p/${escape(project.slug)}/files/docs/roadmap/${escape(current.featureSlug)}/prototypes/${escape(encodeURIComponent(first))}" loading="lazy"></iframe>`
        : `<p class="muted">No prototype HTML files found.</p>`;
      return `
        <div class="triage-prototypes">
          <div class="tabs">${tabs}</div>
          ${iframe}
        </div>
        ${captureFeedbackForm(project, itemId, "prototypes", "Capture prototype review", "Goal clarity, progressive disclosure, information hierarchy, state legibility, action locality, reversibility, empty/error states. What works, what fails, which direction to keep.", returnTo, "Capture review")}
        <p class="muted"><a href="/p/${escape(project.slug)}/roadmap/${escape(current.featureSlug)}/review-prototypes/${escape(encodeURIComponent(first ?? ""))}">Switch to dedicated review page (more space)</a></p>`;
    }

    case "review-architecture": {
      const arch = readFileSafely(join(dir, "architecture.md"));
      return `
        ${artefactBlock("architecture.md", arch, `${featureFileBase}/architecture.md`)}
        <p class="muted">Captured as feedback with <code>applies_to: architecture</code>. PM-assistant will produce <code>architecture-review.md</code> with a verdict.</p>
        ${captureFeedbackForm(project, itemId, "architecture", "Capture architecture review", "Approved guardrails, rejected/revised guardrails, open architecture questions, whether the feature may advance to spec.", returnTo, "Capture review")}`;
    }

    case "clarify-feature": {
      return `
        <p class="muted">No <code>notes.md</code> yet. Capture a brief clarification: what feels broken, what users are trying to achieve, what the model already gets right, and any constraints or examples.</p>
        <form class="triage-form" method="post" action="/p/${escape(project.slug)}/action/capture-clarification?return=${encodeURIComponent(returnTo)}">
          <input type="hidden" name="item-id" value="${escape(itemId)}">
          <label>Raw clarification</label>
          <textarea name="text" required placeholder="Describe the feature in your own words." autofocus></textarea>
          <div class="triage-form-actions">
            <button type="submit">Capture clarification</button>
          </div>
        </form>`;
    }

    case "ready-to-promote": {
      const handoff = readFileSafely(join(dir, "implementation-handoff.md"));
      return `
        ${artefactBlock("implementation-handoff.md", handoff, `${featureFileBase}/implementation-handoff.md`)}
        <p class="muted">Promotion creates <code>.worktrees/roadmap-${escape(itemId)}-${escape(current.featureSlug)}/</code>, an <code>auto/roadmap-…</code> branch, and writes a normalised build plan into the worktree. The implementation BT runs from the worktree, not the main checkout.</p>
        <form class="triage-form" method="post" action="/p/${escape(project.slug)}/action/promote-ready-item?return=${encodeURIComponent(returnTo)}">
          <input type="hidden" name="item-id" value="${escape(itemId)}">
          <div class="triage-form-actions">
            <button type="submit">Promote to build worktree</button>
          </div>
        </form>`;
    }

    case "merge-ready": {
      const wtName = `roadmap-${itemId}-${current.featureSlug}`;
      const readyForUser = readFileSafely(join(project.path, ".worktrees", wtName, ".claude", "state", "ready-for-user.md"));
      return `
        ${readyForUser ? artefactBlock("ready-for-user.md", readyForUser, null) : `<p class="muted">No <code>ready-for-user.md</code> in the worktree yet — meta computed READY from the same gates that build-loop's <code>signal-ready</code> uses.</p>`}
        <p>Worktree: <a href="${escape(fileUrl(join(project.path, ".worktrees", wtName)))}">${escape(wtName)}</a></p>
        <form class="triage-form" method="post" action="/p/${escape(project.slug)}/action/open-build?return=${encodeURIComponent(returnTo)}">
          <input type="hidden" name="worktree" value="${escape(wtName)}">
          <div class="triage-form-actions">
            <button type="submit">Open build (xcodebuild + open .app)</button>
          </div>
        </form>
        <p class="muted">Merging is a manual step in the main checkout. The triage flow ends here — when you're satisfied, <code>git merge --squash auto/${escape(`roadmap-${itemId}-${current.featureSlug}`)}</code> from <code>main</code>.</p>`;
    }
  }
}

export function renderTriageBody(project: Project, queue: QueueItem[], index: number): string {
  if (queue.length === 0) {
    return `
      <h1>Triage</h1>
      <div class="panel queue-panel queue-empty">
        <p>Nothing in the queue. The PM and build loops are quiet.</p>
        <p><a href="/p/${escape(project.slug)}">← back to ${escape(project.name)}</a></p>
      </div>`;
  }

  const i = Math.max(0, Math.min(index, queue.length - 1));
  const current = queue[i]!;
  const prev = i > 0 ? i - 1 : null;
  const next = i < queue.length - 1 ? i + 1 : null;
  const returnTo = next !== null
    ? `/p/${project.slug}/queue?i=${next}`
    : `/p/${project.slug}/queue`;

  const list = queue
    .map(
      (q, n) =>
        `<li class="${n === i ? "current" : ""}"><a href="?i=${n}">${escape(QUEUE_KIND_LABEL[q.kind])} — ${escape(q.featureTitle)}</a></li>`,
    )
    .join("");

  return `
    <h1>Triage <span class="muted">${i + 1} / ${queue.length}</span></h1>

    <div class="triage-card">
      <div class="triage-card-head">
        <span class="queue-kind queue-kind-${escape(current.kind)}">${escape(QUEUE_KIND_LABEL[current.kind])}${current.subId ? ` #${escape(current.subId)}` : ""}</span>
        <span class="muted">item ${escape(current.featureId)} · ${escape(current.featureTitle)}</span>
        <a class="muted triage-feature-link" href="${escape(current.href)}">open feature page →</a>
      </div>
      <h2>${escape(current.subTitle ?? current.featureTitle)}</h2>
      ${current.subId ? "" : `<p class="triage-context">${escape(current.context)}</p>`}
      ${renderTriageCardBody(project, current, returnTo)}
    </div>

    <nav class="triage-nav">
      ${prev !== null ? `<a class="triage-prev" href="?i=${prev}" accesskey="p">← Previous (p)</a>` : `<span class="triage-prev muted">— start —</span>`}
      ${next !== null ? `<a class="triage-next" href="?i=${next}" accesskey="n">Skip (n) →</a>` : `<span class="triage-next muted">— end —</span>`}
      <a class="triage-back" href="/p/${escape(project.slug)}">back to ${escape(project.name)}</a>
    </nav>

    <details class="triage-overview">
      <summary>All ${queue.length} items</summary>
      <ol class="triage-overview-list">${list}</ol>
    </details>

    <script>
      document.addEventListener("keydown", (e) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        if ((e.key === "j" || e.key === "ArrowRight") && !e.metaKey && !e.ctrlKey) { const a = document.querySelector(".triage-next"); if (a instanceof HTMLAnchorElement) a.click(); }
        if ((e.key === "k" || e.key === "ArrowLeft") && !e.metaKey && !e.ctrlKey) { const a = document.querySelector(".triage-prev"); if (a instanceof HTMLAnchorElement) a.click(); }
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { const f = document.querySelector(".triage-form"); if (f instanceof HTMLFormElement) f.requestSubmit(); }
      });
    </script>`;
}

function renderActionQueue(project: Project, queue: QueueItem[]): string {
  if (queue.length === 0) {
    return `
      <section class="panel wide queue-panel queue-empty">
        <h2>Action queue</h2>
        <p class="muted">Nothing needs your attention. The PM and build loops are running cleanly.</p>
      </section>`;
  }

  const rows = queue
    .map((q, i) => {
      const triageHref = `/p/${escape(project.slug)}/queue?i=${i}`;
      return `
        <li class="queue-row queue-${escape(q.kind)}">
          <a class="queue-link" href="${triageHref}">
            <span class="queue-kind">${escape(QUEUE_KIND_LABEL[q.kind])}${q.subId ? ` <span class="queue-sub">#${escape(q.subId)}</span>` : ""}</span>
            <span class="queue-feature"><strong>${escape(q.featureTitle)}</strong> <span class="muted">(item ${escape(q.featureId)})</span>${q.subTitle ? `<div class="queue-subtitle">${escape(q.subTitle)}</div>` : ""}</span>
            <span class="queue-context">${escape(q.context)}</span>
          </a>
        </li>`;
    })
    .join("");

  return `
    <section class="panel wide queue-panel">
      <div class="queue-header">
        <h2>Action queue <span class="badge attention-badge">${queue.length}</span></h2>
        <a class="queue-triage-link" href="/p/${escape(project.slug)}/queue">Triage one at a time →</a>
      </div>
      <ol class="queue-list">${rows}</ol>
    </section>`;
}

function renderSummary(project: Project, items: FeatureItem[], readyWorktrees: number): string {
  const blocked = items.filter((it) => it.status === "blocked" || it.hasArtifact["open-questions.md"]).length;
  const promotionItems = items
    .filter(isReadyForPromotion)
    .map((item) => ({ item, state: promotionState(project, item) }));
  const readyForBuild = promotionItems.filter(({ state }) => !state.promoted).length;

  const card = (label: string, value: number, klass = "") =>
    `<div class="summary-item"><div class="label">${escape(label)}</div><div class="value ${klass}">${value}</div></div>`;

  return `
    <section class="summary">
      ${card("Active items", items.filter((it) => it.status !== "deferred").length)}
      ${card("Blocked", blocked, blocked > 0 ? "attention" : "ok")}
      ${card("Ready to promote", readyForBuild, readyForBuild > 0 ? "ok" : "")}
      ${card("Worktrees ready to merge", readyWorktrees, readyWorktrees > 0 ? "ok" : "")}
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

function renderArchitectureDiagramPanel(featureDir: string): string {
  const inventory = architectureDiagramInventory(featureDir);
  const requirementRows = ARCHITECTURE_DIAGRAM_KINDS
    .map((kind) => {
      const present = inventory.coverage[kind.id];
      return `
        <tr>
          <td>${present ? `<span class="ok">present</span>` : `<span class="attention">missing</span>`}</td>
          <td><strong>${escape(kind.label)}</strong></td>
          <td class="muted">${escape(kind.hint)}</td>
        </tr>`;
    })
    .join("");

  const diagramCards = inventory.diagrams.length > 0
    ? inventory.diagrams
        .map((diagram) => {
          const kinds = diagram.kinds.length > 0
            ? diagram.kinds
                .map((kind) => ARCHITECTURE_DIAGRAM_KINDS.find((k) => k.id === kind)?.label ?? kind)
                .join(", ")
            : "uncategorized";
          return `
            <figure class="architecture-diagram-card">
              <figcaption>
                <strong>${escape(diagram.title)}</strong>
                <span class="muted">${escape(kinds)}</span>
              </figcaption>
              <div class="mermaid">${escape(diagram.source)}</div>
            </figure>`;
        })
        .join("")
    : `<p class="muted">No Mermaid diagrams found in <code>architecture.md</code>.</p>`;

  return `
    <section class="panel architecture-diagrams">
      <h2>Architecture Diagrams</h2>
      <p class="muted">Expected Mermaid diagrams from <code>architecture.md</code>: data model, pipeline/data-flow, and component responsibility boundaries.</p>
      <table>
        <thead><tr><th>Status</th><th>Diagram Type</th><th>Expected Signal</th></tr></thead>
        <tbody>${requirementRows}</tbody>
      </table>
      <h3>Rendered Diagrams</h3>
      <div class="architecture-diagram-list">${diagramCards}</div>
    </section>`;
}

interface PhaseStep {
  id: string;
  label: string;
  status: "done" | "in-progress" | "missing" | "needs-rework";
  href?: string;
}

interface Phase {
  id: string;
  label: string;
  steps: PhaseStep[];
}

interface FeatureNextAction {
  verb: string;
  role: "user" | "pm-assistant" | "build" | "done";
  reason: string;
  href?: string;
  ctaLabel: string;
}

function fileRouteFor(project: Project, absPath: string): string {
  return `/p/${project.slug}/files/${absPath
    .slice(project.path.length + 1)
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/")}`;
}

function computePhases(
  project: Project,
  dir: string,
  slug: string,
  worktree: BuildWorktree | null,
): Phase[] {
  const has = (f: string) => existsSync(join(dir, f));
  const fileLink = (f: string) => `/p/${project.slug}/files/docs/roadmap/${slug}/${f}`;

  const protoFiles = existsSync(join(dir, "prototypes"))
    ? readdirSync(join(dir, "prototypes")).filter((f) => f.endsWith(".html"))
    : [];

  const uxNeedsRework = has("ux-review.md") && reviewVerdictNeedsRework(dir, "ux-review.md");
  const archNeedsRework = has("architecture-review.md") && reviewVerdictNeedsRework(dir, "architecture-review.md");

  function s(id: string, label: string, present: boolean, link?: string, rework = false): PhaseStep {
    if (rework) return { id, label, status: "needs-rework", href: link };
    return { id, label, status: present ? "done" : "missing", href: present ? link : undefined };
  }

  const phases: Phase[] = [
    {
      id: "discover",
      label: "Discover",
      steps: [
        s("notes", "notes", has("notes.md"), fileLink("notes.md")),
        s("stories", "user-stories", has("user-stories.md"), fileLink("user-stories.md")),
        s("existing", "existing-state", has("existing-state.md"), fileLink("existing-state.md")),
      ],
    },
    {
      id: "prototype",
      label: "Prototype",
      steps: [
        {
          id: "protos",
          label: protoFiles.length > 0 ? `${protoFiles.length} prototype${protoFiles.length === 1 ? "" : "s"}` : "prototypes",
          status: protoFiles.length > 0 ? "done" : "missing",
        },
        s("ux-review", "ux-review", has("ux-review.md"), fileLink("ux-review.md"), uxNeedsRework),
      ],
    },
    {
      id: "architect",
      label: "Architect",
      steps: [
        s("arch", "architecture", has("architecture.md"), fileLink("architecture.md")),
        s("arch-review", "review", has("architecture-review.md"), fileLink("architecture-review.md"), archNeedsRework),
      ],
    },
    {
      id: "specify",
      label: "Specify",
      steps: [
        s("spec", "spec", has("spec.md"), fileLink("spec.md")),
        s("plan", "plan", has("plan.md"), fileLink("plan.md")),
        s("handoff", "handoff", has("implementation-handoff.md"), fileLink("implementation-handoff.md")),
      ],
    },
    {
      id: "build",
      label: "Build",
      steps: worktree
        ? [
            { id: "promoted", label: "promoted", status: "done" },
            {
              id: "tests",
              label: "tests",
              status:
                worktree.lastReviewSha === worktree.headSha && worktree.headSha !== ""
                  ? "done"
                  : worktree.testsFailurePresent
                    ? "needs-rework"
                    : "in-progress",
            },
            {
              id: "review",
              label: "reviewed",
              status:
                worktree.lastReviewSha === worktree.headSha && worktree.headSha !== ""
                  ? "done"
                  : "in-progress",
            },
          ]
        : [{ id: "promoted", label: "promote", status: "missing" }],
    },
    {
      id: "ready",
      label: "Ready",
      steps: [
        {
          id: "ready",
          label: worktree?.isReady ? "ready to merge" : "blocked",
          status: worktree?.isReady ? "done" : "missing",
        },
      ],
    },
  ];

  return phases;
}

function nextActionForFeature(
  project: Project,
  item: FeatureItem,
  worktree: BuildWorktree | null,
): FeatureNextAction {
  const dir = item.dir;
  const has = (f: string) => existsSync(join(dir, f));
  const reviewBase = `/p/${project.slug}/roadmap/${item.slug}`;

  if (item.status === "deferred") {
    return { verb: "deferred", role: "done", reason: "Status: deferred. No action until reactivated.", ctaLabel: "Reactivate manually" };
  }

  if (concernsOpen(dir)) {
    return { verb: "review-concerns", role: "user", reason: "concerns.md is open. Decide acceptance.", href: `${reviewBase}#concerns`, ctaLabel: "Review concerns" };
  }

  if (item.status === "blocked" || has("open-questions.md")) {
    return {
      verb: "answer-open-questions",
      role: "user",
      reason: has("open-questions.md") ? "open-questions.md awaits your answer." : "Status: blocked.",
      href: has("open-questions.md") ? `/p/${project.slug}/files/docs/roadmap/${item.slug}/open-questions.md` : undefined,
      ctaLabel: "Open questions",
    };
  }

  if (!has("notes.md")) {
    return { verb: "clarify-feature", role: "user", reason: "No notes.md yet. Capture a clarification.", ctaLabel: "Capture clarification" };
  }
  if (!has("user-stories.md")) {
    return { verb: "draft-user-stories", role: "pm-assistant", reason: "PM-assistant will draft user-stories.md on next heartbeat.", ctaLabel: "Waiting on PM agent" };
  }
  if (!has("existing-state.md")) {
    return { verb: "inspect-existing-state", role: "pm-assistant", reason: "PM-assistant will inspect existing implementation.", ctaLabel: "Waiting on PM agent" };
  }

  const protoDir = join(dir, "prototypes");
  const protoFiles = existsSync(protoDir) ? readdirSync(protoDir).filter((f) => f.endsWith(".html")).sort() : [];

  if (protoFiles.length === 0) {
    return { verb: "build-prototypes", role: "pm-assistant", reason: "PM-assistant will build Balsamiq-style prototypes.", ctaLabel: "Waiting on PM agent" };
  }

  if (!has("ux-review.md") || reviewVerdictNeedsRework(dir, "ux-review.md")) {
    const first = protoFiles[0]!;
    return {
      verb: "review-prototypes",
      role: "user",
      reason: has("ux-review.md") ? "ux-review.md verdict requested rework." : `${protoFiles.length} prototype${protoFiles.length === 1 ? "" : "s"} waiting for UX review.`,
      href: `${reviewBase}/review-prototypes/${encodeURIComponent(first)}`,
      ctaLabel: "Review prototypes →",
    };
  }

  if (!has("architecture.md")) {
    return { verb: "write-architecture", role: "pm-assistant", reason: "PM-assistant will write architecture guardrails.", ctaLabel: "Waiting on PM agent" };
  }
  if (!has("architecture-review.md") || reviewVerdictNeedsRework(dir, "architecture-review.md")) {
    return {
      verb: "review-architecture",
      role: "user",
      reason: has("architecture-review.md") ? "architecture-review.md verdict requested rework." : "architecture.md is written; needs your review before spec.",
      href: `/p/${project.slug}/files/docs/roadmap/${item.slug}/architecture.md`,
      ctaLabel: "Review architecture →",
    };
  }
  if (!has("spec.md")) return { verb: "write-spec", role: "pm-assistant", reason: "PM-assistant will write the spec.", ctaLabel: "Waiting on PM agent" };
  if (!has("plan.md")) return { verb: "write-plan", role: "pm-assistant", reason: "PM-assistant will write the plan.", ctaLabel: "Waiting on PM agent" };
  if (!has("implementation-handoff.md")) return { verb: "write-implementation-handoff", role: "pm-assistant", reason: "PM-assistant will write the build handoff.", ctaLabel: "Waiting on PM agent" };

  if (!worktree) {
    return { verb: "promote", role: "user", reason: "All PM artifacts complete. Promote to a build worktree.", ctaLabel: "Promote to build →" };
  }

  if (worktree.isReady) {
    return {
      verb: "merge-ready",
      role: "user",
      reason: `Worktree ${worktree.name} is fully reviewed and ready. Diff ${worktree.mergeBase ? `${worktree.mergeBase.slice(0, 7)}..${worktree.headSha.slice(0, 7)}` : "vs main"}.`,
      href: fileUrl(worktree.path),
      ctaLabel: "Open worktree to merge →",
    };
  }

  const blockers = worktree.readyBlockers;
  return {
    verb: "build-in-progress",
    role: "build",
    reason: blockers.length > 0 ? `Build loop in progress: ${blockers.join("; ")}` : "Build loop in progress.",
    ctaLabel: "Watch build worktree",
    href: fileUrl(worktree.path),
  };
}

const PHASE_STEP_ICON: Record<PhaseStep["status"], string> = {
  done: "●",
  "in-progress": "◐",
  missing: "○",
  "needs-rework": "⚠",
};

function renderPipelineStrip(phases: Phase[]): string {
  const cells = phases
    .map((phase) => {
      const dots = phase.steps
        .map((step) => `<span class="pipe-dot pipe-${step.status}" title="${escape(step.label)}: ${escape(step.status)}">${PHASE_STEP_ICON[step.status]}</span>`)
        .join(" ");
      const hasDone = phase.steps.some((s) => s.status === "done");
      const allDone = phase.steps.every((s) => s.status === "done");
      const phaseClass = allDone ? "phase-done" : hasDone ? "phase-active" : "phase-pending";
      return `
        <div class="pipe-phase ${phaseClass}">
          <div class="pipe-phase-label">${escape(phase.label)}</div>
          <div class="pipe-dots">${dots}</div>
        </div>`;
    })
    .join('<div class="pipe-arrow">›</div>');
  return `<div class="pipeline-strip">${cells}</div>`;
}

function renderHeroBlock(item: FeatureItem, action: FeatureNextAction): string {
  const roleClass = `hero-role-${action.role}`;
  const ctaHref = action.href ?? "";
  const cta = ctaHref
    ? `<a class="hero-cta" href="${escape(ctaHref)}">${escape(action.ctaLabel)}</a>`
    : `<span class="hero-cta hero-cta-passive">${escape(action.ctaLabel)}</span>`;

  return `
    <section class="feature-hero ${roleClass}">
      <div class="hero-meta">
        <span class="badge ${item.status === "blocked" ? "attention-badge" : item.status === "deferred" ? "dormant" : "active"}">${escape(item.status)}</span>
        <span class="muted">item ${escape(item.id)}</span>
        <span class="muted">stage <code>${escape(item.stage)}</code></span>
      </div>
      <h1>${escape(item.title)}</h1>
      <div class="hero-action">
        <div class="hero-action-text">
          <div class="hero-verb">NEXT: <code>${escape(action.verb)}</code> <span class="hero-role-badge">${escape(action.role)}</span></div>
          <p>${escape(action.reason)}</p>
        </div>
        <div class="hero-cta-wrap">${cta}</div>
      </div>
    </section>`;
}

function renderArtefactsByPhase(phases: Phase[], project: Project, dir: string, slug: string): string {
  const protoFiles = existsSync(join(dir, "prototypes"))
    ? readdirSync(join(dir, "prototypes")).filter((f) => f.endsWith(".html")).sort()
    : [];

  function stepRow(step: PhaseStep): string {
    const label = `<span class="artefact-status art-${step.status}">${PHASE_STEP_ICON[step.status]}</span> <span class="artefact-name">${escape(step.label)}</span>`;
    const link = step.href
      ? `<a href="${escape(step.href)}">open</a>`
      : `<span class="muted">${escape(step.status)}</span>`;
    return `<li>${label}<span class="artefact-link">${link}</span></li>`;
  }

  const sections = phases.map((phase) => {
    let body = `<ul class="artefact-list">${phase.steps.map(stepRow).join("")}</ul>`;
    if (phase.id === "prototype" && protoFiles.length > 0) {
      const protoLinks = protoFiles
        .map(
          (f) =>
            `<li><a href="/p/${escape(project.slug)}/roadmap/${escape(slug)}/review-prototypes/${escape(encodeURIComponent(f))}">${escape(f.replace(/\.html$/, ""))}</a></li>`,
        )
        .join("");
      body += `<div class="artefact-sub"><h4>Prototypes</h4><ul>${protoLinks}</ul></div>`;
    }
    return `
      <div class="artefact-phase">
        <h3>${escape(phase.label)}</h3>
        ${body}
      </div>`;
  }).join("");

  return `
    <section class="panel wide">
      <h2>Artefacts</h2>
      <div class="artefact-grid">${sections}</div>
    </section>`;
}

export function renderFeaturePage(project: Project, slug: string): string | null {
  const paths = roadmapPaths(project);
  if (!paths) return null;
  const dir = join(paths.root, slug);
  if (!existsSync(dir)) return null;
  const readme = join(dir, "README.md");
  const fm = readFrontmatter(readme);
  if (!fm) return null;

  const allItems = readFeatures(paths.root);
  const item = allItems.find((it) => it.slug === slug);
  if (!item) return null;

  const allWorktrees = listBuildWorktrees(project, allItems);
  const worktree = allWorktrees.find((wt) => wt.featureSlug === slug) ?? null;

  const phases = computePhases(project, dir, slug, worktree);
  const action = nextActionForFeature(project, item, worktree);

  const captureFeedbackScript = paths.scripts.captureFeedback;
  const itemId = String(fm.data.id);

  const fbDir = join(dir, "feedback");
  let feedbackPanel = "";
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
      const open = files.filter((f) => {
        const fm2 = readFrontmatter(join(fbDir, f));
        const status = (fm2?.data.status as string) ?? "new";
        return status !== "handled" && status !== "archived";
      }).length;
      feedbackPanel = `
        <section class="panel">
          <h2>Feedback ${open > 0 ? `<span class="badge attention-badge">${open} open</span>` : ""}</h2>
          <table>
            <thead><tr><th>File</th><th>Applies to</th><th>Status</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </section>`;
    }
  }

  const captureForm = captureFeedbackScript
    ? `
      <details class="capture-form-details">
        <summary>Capture feedback on this feature</summary>
        <form class="action-form" method="post" action="/p/${escape(project.slug)}/action/capture-feedback">
          <input type="hidden" name="item-id" value="${escape(itemId)}">
          <label>Applies to</label>
          <select name="applies-to" required>
            <option value="general">general</option>
            <option value="prototypes">prototypes</option>
            <option value="architecture">architecture</option>
            <option value="spec">spec</option>
            <option value="plan">plan</option>
          </select>
          <label>Raw feedback</label>
          <textarea name="text" required placeholder="What works, what fails, what to flag for the PM agent."></textarea>
          <button type="submit">Capture</button>
        </form>
      </details>`
    : "";

  const frontmatterTable = Object.entries(fm.data)
    .map(([k, v]) => `<tr><td><strong>${escape(k)}</strong></td><td><code>${escape(JSON.stringify(v))}</code></td></tr>`)
    .join("");

  return `
    ${renderHeroBlock(item, action)}
    ${renderPipelineStrip(phases)}
    ${renderArtefactsByPhase(phases, project, dir, slug)}
    ${existsSync(join(dir, "architecture.md")) ? renderArchitectureDiagramPanel(dir) : ""}
    ${feedbackPanel}
    ${captureForm}

    <details class="reference-details">
      <summary>Reference (frontmatter, file path)</summary>
      <p class="muted"><a href="${escape(fileUrl(dir))}">${escape(dir)}</a></p>
      <table><tbody>${frontmatterTable}</tbody></table>
    </details>`;
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
    const worktrees = listBuildWorktrees(ctx.project, items);
    const readyWorktrees = worktrees.filter((wt) => wt.isReady).length;
    const queue = computeActionQueue(ctx.project, items, worktrees);
    return `
      ${renderActionQueue(ctx.project, queue)}
      ${renderSummary(ctx.project, items, readyWorktrees)}
      ${renderFeatureTable(ctx.project, items)}
      <details class="reference-details">
        <summary>Reference panels (worktree state, promotion queue, capture forms)</summary>
        ${renderBuildWorktreesPanel(ctx.project, items)}
        ${renderPromotionPanel(ctx.project, items, paths)}
        ${renderNextActions(ctx.project, items, paths)}
        ${renderActionForms(ctx.project, paths, items)}
      </details>`;
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
    if (paths.scripts.promote) {
      out.push({
        id: "promote-ready-item",
        label: "Promote Ready Item",
        fields: [
          { name: "item-id", label: "Item ID", type: "text", required: true },
        ],
      });
    }
    // Always advertise open-build; per-worktree availability is checked at handle time.
    out.push({
      id: "open-build",
      label: "Open latest build for a worktree",
      fields: [
        { name: "worktree", label: "Worktree name", type: "text", required: true },
      ],
    });
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

    if (req.action === "promote-ready-item" && paths.scripts.promote) {
      const itemId = req.values["item-id"];
      if (!itemId) return { ok: false, output: "Missing item-id" };
      return runScript([paths.scripts.promote, itemId], cwd);
    }

    if (req.action === "open-build") {
      const wtName = req.values["worktree"];
      if (!wtName) return { ok: false, output: "Missing worktree" };
      // Defence in depth: refuse anything that escapes the .worktrees/ root.
      if (wtName.includes("..") || wtName.includes("/")) {
        return { ok: false, output: "Invalid worktree name" };
      }
      const wtPath = join(req.project.path, ".worktrees", wtName);
      const scriptPath = join(wtPath, "scripts", "open-latest-build.sh");
      if (!existsSync(wtPath)) return { ok: false, output: `Worktree not found: ${wtPath}` };
      if (!existsSync(scriptPath)) return { ok: false, output: `Script not found: ${scriptPath}` };
      return runScript([scriptPath], wtPath);
    }

    return { ok: false, output: `Unknown action ${req.action}` };
  },
};
