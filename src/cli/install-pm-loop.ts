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

const args = process.argv.slice(2);
let force = false;
let dryRun = false;
let bundlePath = resolve(import.meta.dir, "..", "..", "..", "pm-loop");
let target: string | null = null;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--force") force = true;
  else if (a === "--dry-run") dryRun = true;
  else if (a === "--bundle") bundlePath = resolve(args[++i]!);
  else if (a === "--help" || a === "-h") {
    console.log(`usage: install-pm-loop [--bundle <path>] [--force] [--dry-run] <project-path>

Installs the pm-loop bundle into a target project. Refuses to overwrite
files whose target hash differs from the previous lock-recorded hash
unless --force is passed (so user edits inside the project are not
silently clobbered).

Defaults:
  --bundle  ${bundlePath}
`);
    process.exit(0);
  } else if (!target) target = resolve(a!);
  else {
    console.error(`unexpected argument: ${a}`);
    process.exit(2);
  }
}

if (!target) {
  console.error("missing <project-path>. run with --help for usage.");
  process.exit(2);
}

if (!existsSync(bundlePath)) {
  console.error(`bundle not found at ${bundlePath}`);
  process.exit(1);
}
if (!existsSync(target)) {
  console.error(`target project not found at ${target}`);
  process.exit(1);
}

const manifestPath = join(bundlePath, "manifest.yaml");
if (!existsSync(manifestPath)) {
  console.error(`manifest not found at ${manifestPath}`);
  process.exit(1);
}

const manifest = YAML.parse(readFileSync(manifestPath, "utf8")) as Manifest;

function gitSha(repo: string): string {
  try {
    const proc = Bun.spawnSync(["git", "-C", repo, "rev-parse", "HEAD"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return new TextDecoder().decode(proc.stdout).trim();
  } catch {
    return "unknown";
  }
}

function fileHash(path: string): string {
  const h = createHash("sha256");
  h.update(readFileSync(path));
  return h.digest("hex");
}

const sourceSha = gitSha(bundlePath);
const lockPath = join(target, ".pm-loop.lock");
const previousLock: Lockfile | null = existsSync(lockPath)
  ? (JSON.parse(readFileSync(lockPath, "utf8")) as Lockfile)
  : null;

const previousByTarget = new Map<string, LockEntry>();
if (previousLock) for (const e of previousLock.files) previousByTarget.set(e.target, e);

const conflicts: { path: string; reason: string }[] = [];
const planned: { src: string; dst: string; mode?: string; hash: string }[] = [];

for (const file of manifest.files) {
  const src = join(bundlePath, file.source);
  const dst = join(target, file.target);
  if (!existsSync(src)) {
    console.error(`bundle file missing: ${src}`);
    process.exit(1);
  }
  const newHash = fileHash(src);
  planned.push({ src, dst, mode: file.mode, hash: newHash });

  if (existsSync(dst)) {
    const currentHash = fileHash(dst);
    const prev = previousByTarget.get(file.target);
    if (currentHash === newHash) continue; // same file, skip
    if (prev && currentHash !== prev.hash && !force) {
      conflicts.push({
        path: file.target,
        reason: "target has been modified since last install (drift)",
      });
    }
    if (!prev && !force) {
      conflicts.push({
        path: file.target,
        reason: "target file already exists and was not installed by pm-loop",
      });
    }
  }
}

if (conflicts.length > 0 && !force) {
  console.error("install would overwrite local changes:");
  for (const c of conflicts) console.error(`  ${c.path}: ${c.reason}`);
  console.error("re-run with --force to overwrite.");
  process.exit(3);
}

console.log(`bundle: ${manifest.name}@${manifest.version} (sha ${sourceSha.slice(0, 7)})`);
console.log(`target: ${target}`);
console.log(`files:  ${planned.length}`);

if (dryRun) {
  for (const p of planned) console.log(`  would install ${p.dst}`);
  process.exit(0);
}

const installed: LockEntry[] = [];
for (const p of planned) {
  mkdirSync(dirname(p.dst), { recursive: true });
  copyFileSync(p.src, p.dst);
  if (p.mode) {
    chmodSync(p.dst, parseInt(p.mode, 8));
  }
  console.log(`  installed ${p.dst}`);
  installed.push({
    source: p.src.slice(bundlePath.length + 1),
    target: p.dst.slice(target.length + 1),
    hash: p.hash,
    mode: p.mode,
  });
}

const lock: Lockfile = {
  bundle: manifest.name,
  version: manifest.version,
  source_repo: bundlePath,
  source_sha: sourceSha,
  installed_at: new Date().toISOString(),
  files: installed,
};
writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
console.log(`wrote ${lockPath}`);
