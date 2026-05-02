import { resolve } from "node:path";
import { discoverProjects, loadConfig } from "../discovery.ts";
import { buildOrchestratorModel } from "../orchestrator/model.ts";

const CONFIG_PATH = resolve(import.meta.dir, "..", "..", "config.yaml");

interface CliOptions {
  json: boolean;
  refresh: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  return {
    json: argv.includes("--json"),
    refresh: argv.includes("--refresh"),
  };
}

function commandLine(command: string[]): string {
  return command.length > 0 ? command.join(" ") : "(none)";
}

function printMarkdown(model: ReturnType<typeof buildOrchestratorModel>): void {
  console.log("# Orchestrator Leases");
  console.log();
  console.log(`Generated: ${model.generatedAt}`);
  console.log(`Limits: leases=${model.limits.maxLeases}, pm=${model.limits.maxPmLeases}, build=${model.limits.maxBuildLeases}, xcodebuild=${model.limits.maxXcodebuildLeases}`);
  console.log();

  console.log("## Granted");
  if (model.granted.length === 0) {
    console.log();
    console.log("- none");
  } else {
    for (const lease of model.granted) {
      console.log();
      console.log(`- **${lease.kind}** ${lease.project} / ${lease.title}`);
      console.log(`  - action: \`${lease.action}\``);
      console.log(`  - cwd: \`${lease.cwd}\``);
      console.log(`  - command: \`${commandLine(lease.command)}\``);
      console.log(`  - exclusive: ${lease.exclusive.map((k) => `\`${k}\``).join(", ")}`);
      if (lease.sharedLimits.length > 0) console.log(`  - shared limits: ${lease.sharedLimits.map((k) => `\`${k}\``).join(", ")}`);
      console.log(`  - reason: ${lease.reason}`);
    }
  }

  console.log();
  console.log("## Attention");
  if (model.attention.length === 0 && model.ready.length === 0) {
    console.log();
    console.log("- none");
  } else {
    for (const lease of [...model.attention, ...model.ready]) {
      console.log();
      console.log(`- **${lease.kind}** ${lease.project} / ${lease.title}: \`${lease.action}\``);
      console.log(`  - ${lease.reason}`);
      console.log(`  - source: \`${lease.source}\``);
    }
  }

  console.log();
  console.log("## Blocked By Lease Limits");
  if (model.blocked.length === 0) {
    console.log();
    console.log("- none");
  } else {
    for (const lease of model.blocked) {
      console.log();
      console.log(`- ${lease.project} / ${lease.title}: \`${lease.action}\` (${lease.kind})`);
    }
  }
}

const opts = parseArgs(Bun.argv.slice(2));
const config = loadConfig(CONFIG_PATH);
const projects = await discoverProjects(config);
const model = buildOrchestratorModel(projects, { refreshSelectors: opts.refresh });

if (opts.json) {
  console.log(JSON.stringify(model, null, 2));
} else {
  printMarkdown(model);
}
