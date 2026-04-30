#!/usr/bin/env bun
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import YAML from "yaml";
import { createHash } from "node:crypto";

interface ManifestFile {
  source: string;
  target: string;
  mode?: string;
}
interface Manifest {
  name: string;
  version: string;
  description?: string;
  requires?: string[];
  files: ManifestFile[];
}
interface LockEntry {
  source: string;
  target: string;
  hash: string;
  mode?: string;
}
interface Lockfile {
  bundle: string;
  version: string;
  source_repo: string;
  source_sha: string;
  installed_at: string;
  files: LockEntry[];
}

const DEFAULT_BUNDLE = resolve(import.meta.dir, "..", "..", "..", "pm-loop");

interface Opts {
  command: string;
  bundle: string;
  target: string | null;
  force: boolean;
  dryRun: boolean;
  rest: string[];
}

function parseArgs(argv: string[]): Opts {
  const opts: Opts = {
    command: "",
    bundle: DEFAULT_BUNDLE,
    target: null,
    force: false,
    dryRun: false,
    rest: [],
  };
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    opts.command = "help";
    return opts;
  }
  opts.command = argv[0]!;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--force") opts.force = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--bundle") opts.bundle = resolve(argv[++i]!);
    else if (a === "-h" || a === "--help") {
      opts.command = "help";
      opts.rest.unshift(opts.command);
      return opts;
    } else if (!opts.target) opts.target = resolve(a);
    else opts.rest.push(a);
  }
  return opts;
}

function fileHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function gitSha(repo: string): string {
  const proc = Bun.spawnSync(["git", "-C", repo, "rev-parse", "HEAD"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return new TextDecoder().decode(proc.stdout).trim() || "unknown";
}

function loadManifest(bundlePath: string): Manifest {
  const p = join(bundlePath, "manifest.yaml");
  if (!existsSync(p)) {
    throw new Error(`bundle manifest missing at ${p}`);
  }
  return YAML.parse(readFileSync(p, "utf8")) as Manifest;
}

function loadLock(target: string): Lockfile | null {
  const p = join(target, ".pm-loop.lock");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as Lockfile;
}

function writeLock(target: string, lock: Lockfile): void {
  writeFileSync(join(target, ".pm-loop.lock"), JSON.stringify(lock, null, 2) + "\n");
}

type Status =
  | "in-sync"
  | "local-edit"
  | "update-available"
  | "conflict"
  | "missing"
  | "uninstalled"
  | "bundle-missing";

interface FileState {
  source: string;
  target: string;
  mode?: string;
  bundleHash: string | null;
  lockHash: string | null;
  targetHash: string | null;
  status: Status;
}

function computeStates(opts: Opts): FileState[] {
  const manifest = loadManifest(opts.bundle);
  const lock = loadLock(opts.target!);
  const lockByTarget = new Map<string, LockEntry>();
  if (lock) for (const e of lock.files) lockByTarget.set(e.target, e);

  const states: FileState[] = [];
  for (const f of manifest.files) {
    const src = join(opts.bundle, f.source);
    const dst = join(opts.target!, f.target);
    const bundleHash = existsSync(src) ? fileHash(src) : null;
    const targetHash = existsSync(dst) ? fileHash(dst) : null;
    const lockEntry = lockByTarget.get(f.target);
    const lockHash = lockEntry?.hash ?? null;

    let status: Status;
    if (bundleHash === null) status = "bundle-missing";
    else if (targetHash === null) status = "missing";
    else if (lockHash === null) status = "uninstalled";
    else if (targetHash === lockHash && bundleHash === lockHash) status = "in-sync";
    else if (targetHash === lockHash && bundleHash !== lockHash) status = "update-available";
    else if (targetHash !== lockHash && bundleHash === lockHash) status = "local-edit";
    else if (targetHash === bundleHash) status = "in-sync"; // both bumped to same
    else status = "conflict";

    states.push({
      source: f.source,
      target: f.target,
      mode: f.mode,
      bundleHash,
      lockHash,
      targetHash,
      status,
    });
  }
  return states;
}

function statusLabel(s: Status): string {
  switch (s) {
    case "in-sync":
      return "in sync";
    case "missing":
      return "MISSING";
    case "uninstalled":
      return "UNINSTALLED";
    case "update-available":
      return "UPDATE AVAILABLE";
    case "local-edit":
      return "LOCAL EDIT";
    case "conflict":
      return "CONFLICT";
    case "bundle-missing":
      return "BUNDLE MISSING";
  }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function cmdHelp(): never {
  console.log(`usage: pm-loop <command> [options] <project-path>

commands:
  install   copy canonical files into a fresh project. writes .pm-loop.lock
  status    report drift between bundle, lockfile, and target. exit code != 0 if drift
  update    apply bundle changes to files the project hasn't modified. refuse on conflicts
  diff      print unified diff between target and bundle for changed files
  help      this message

options:
  --bundle <path>   path to pm-loop repo (default: ${DEFAULT_BUNDLE})
  --force           overwrite local edits / conflicts (install, update)
  --dry-run         describe what would change without writing (install, update)

drift legend:
  in sync           target == lock == bundle
  UPDATE AVAILABLE  bundle changed since install; target untouched. safe to update.
  LOCAL EDIT        target changed; bundle unchanged. project owns this file now.
  CONFLICT          both target and bundle have changed. needs manual merge.
  MISSING           target file does not exist. install or update will create it.
  UNINSTALLED       target file exists but lockfile has no record. likely pre-bundle install.
`);
  process.exit(0);
}

function requireTarget(opts: Opts): string {
  if (!opts.target) {
    console.error("missing <project-path>. run 'pm-loop help' for usage.");
    process.exit(2);
  }
  if (!existsSync(opts.target)) {
    console.error(`target project not found at ${opts.target}`);
    process.exit(1);
  }
  if (!existsSync(opts.bundle)) {
    console.error(`bundle not found at ${opts.bundle}`);
    process.exit(1);
  }
  return opts.target;
}

function applyFile(bundle: string, target: string, state: FileState): LockEntry {
  const src = join(bundle, state.source);
  const dst = join(target, state.target);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  if (state.mode) chmodSync(dst, parseInt(state.mode, 8));
  return {
    source: state.source,
    target: state.target,
    hash: state.bundleHash!,
    mode: state.mode,
  };
}

function cmdInstall(opts: Opts): never {
  requireTarget(opts);
  const manifest = loadManifest(opts.bundle);
  const states = computeStates(opts);

  // refuse on any pre-existing conflict unless --force
  const blockers = states.filter(
    (s) => s.status === "uninstalled" || s.status === "local-edit" || s.status === "conflict",
  );
  if (blockers.length > 0 && !opts.force) {
    console.error("install would overwrite existing files:");
    for (const s of blockers) console.error(`  ${s.target}: ${statusLabel(s.status)}`);
    console.error("re-run with --force to overwrite. or use 'pm-loop status' / 'update'.");
    process.exit(3);
  }

  console.log(
    `bundle: ${manifest.name}@${manifest.version} (sha ${gitSha(opts.bundle).slice(0, 7)})`,
  );
  console.log(`target: ${opts.target}`);
  console.log(`files:  ${states.length}`);

  if (opts.dryRun) {
    for (const s of states) console.log(`  would install ${s.target}`);
    process.exit(0);
  }

  const installed: LockEntry[] = [];
  for (const s of states) {
    if (s.status === "bundle-missing") {
      console.error(`  bundle file missing: ${s.source}`);
      process.exit(1);
    }
    installed.push(applyFile(opts.bundle, opts.target!, s));
    console.log(`  installed ${s.target}`);
  }

  writeLock(opts.target!, {
    bundle: manifest.name,
    version: manifest.version,
    source_repo: opts.bundle,
    source_sha: gitSha(opts.bundle),
    installed_at: new Date().toISOString(),
    files: installed,
  });
  console.log(`wrote ${join(opts.target!, ".pm-loop.lock")}`);
  process.exit(0);
}

function cmdStatus(opts: Opts): never {
  requireTarget(opts);
  const manifest = loadManifest(opts.bundle);
  const lock = loadLock(opts.target!);
  const states = computeStates(opts);

  const headerBundleSha = gitSha(opts.bundle).slice(0, 7);
  console.log(
    `bundle: ${manifest.name}@${manifest.version} (sha ${headerBundleSha}) at ${opts.bundle}`,
  );
  if (lock) {
    console.log(
      `lock:   ${lock.bundle}@${lock.version} (sha ${lock.source_sha.slice(0, 7)}) installed ${lock.installed_at}`,
    );
  } else {
    console.log(`lock:   none — bundle has not been installed in this project`);
  }
  console.log(`target: ${opts.target}`);
  console.log("");

  const widthFile = Math.max(...states.map((s) => s.target.length), 4);
  console.log(`${pad("FILE", widthFile)}  STATUS`);
  for (const s of states) {
    console.log(`${pad(s.target, widthFile)}  ${statusLabel(s.status)}`);
  }

  const counts = states.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1;
    return acc;
  }, {});
  const driftCount =
    (counts["update-available"] ?? 0) +
    (counts["local-edit"] ?? 0) +
    (counts["conflict"] ?? 0) +
    (counts["missing"] ?? 0) +
    (counts["uninstalled"] ?? 0);

  console.log("");
  console.log(
    `summary: ${counts["in-sync"] ?? 0} in sync, ${counts["update-available"] ?? 0} update available, ${counts["local-edit"] ?? 0} local edits, ${counts["conflict"] ?? 0} conflicts, ${counts["missing"] ?? 0} missing`,
  );

  process.exit(driftCount > 0 ? 1 : 0);
}

function cmdUpdate(opts: Opts): never {
  requireTarget(opts);
  const manifest = loadManifest(opts.bundle);
  const lock = loadLock(opts.target!);
  if (!lock) {
    console.error("no .pm-loop.lock found. use 'pm-loop install' for first install.");
    process.exit(2);
  }
  const states = computeStates(opts);

  const conflicts = states.filter((s) => s.status === "conflict");
  if (conflicts.length > 0 && !opts.force) {
    console.error("update blocked by conflicts (both target and bundle changed):");
    for (const s of conflicts) console.error(`  ${s.target}`);
    console.error("re-run with --force to take the bundle version, or use 'pm-loop diff' to merge manually.");
    process.exit(3);
  }

  const localEdits = states.filter((s) => s.status === "local-edit");
  if (localEdits.length > 0 && !opts.force) {
    console.error("update would skip files with local edits:");
    for (const s of localEdits) console.error(`  ${s.target}`);
    console.error("these files were modified in the project after install. re-run with --force to overwrite.");
  }

  const toApply = states.filter(
    (s) =>
      s.status === "update-available" ||
      s.status === "missing" ||
      (opts.force && (s.status === "conflict" || s.status === "local-edit")),
  );

  if (toApply.length === 0) {
    console.log("nothing to apply.");
    process.exit(0);
  }

  console.log(`bundle: ${manifest.name}@${manifest.version} (sha ${gitSha(opts.bundle).slice(0, 7)})`);
  console.log(`target: ${opts.target}`);
  console.log(`applying ${toApply.length} file(s):`);

  if (opts.dryRun) {
    for (const s of toApply) console.log(`  would apply ${s.target}  (${statusLabel(s.status)})`);
    process.exit(0);
  }

  const updated = new Map<string, LockEntry>();
  for (const e of lock.files) updated.set(e.target, e);
  for (const s of toApply) {
    if (s.status === "bundle-missing") continue;
    const entry = applyFile(opts.bundle, opts.target!, s);
    updated.set(s.target, entry);
    console.log(`  applied ${s.target}  (${statusLabel(s.status)})`);
  }

  writeLock(opts.target!, {
    bundle: manifest.name,
    version: manifest.version,
    source_repo: opts.bundle,
    source_sha: gitSha(opts.bundle),
    installed_at: new Date().toISOString(),
    files: Array.from(updated.values()).sort((a, b) => a.target.localeCompare(b.target)),
  });
  console.log(`updated ${join(opts.target!, ".pm-loop.lock")}`);
  process.exit(0);
}

function cmdDiff(opts: Opts): never {
  requireTarget(opts);
  const states = computeStates(opts);
  const filter = opts.rest[0];
  const matching = states.filter(
    (s) =>
      s.status !== "in-sync" &&
      s.status !== "missing" &&
      (!filter || s.target.includes(filter)),
  );
  if (matching.length === 0) {
    console.log("no diffable files (everything in sync, or filter matched nothing).");
    process.exit(0);
  }
  for (const s of matching) {
    const src = join(opts.bundle, s.source);
    const dst = join(opts.target!, s.target);
    console.log(`\n=== ${s.target}  (${statusLabel(s.status)}) ===`);
    const proc = Bun.spawnSync(["diff", "-u", dst, src], { stdout: "pipe", stderr: "pipe" });
    process.stdout.write(new TextDecoder().decode(proc.stdout));
  }
  process.exit(0);
}

const opts = parseArgs(process.argv.slice(2));
switch (opts.command) {
  case "help":
    cmdHelp();
  case "install":
    cmdInstall(opts);
  case "status":
    cmdStatus(opts);
  case "update":
    cmdUpdate(opts);
  case "diff":
    cmdDiff(opts);
  default:
    console.error(`unknown command: ${opts.command}`);
    cmdHelp();
}
