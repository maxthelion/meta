import type { OrchestratorModel, LeaseCandidate } from "../orchestrator/model.ts";
import type { Project } from "../types.ts";
import { escape, fileUrl } from "../util/html.ts";
import { layout } from "./layout.ts";

function commandText(lease: LeaseCandidate): string {
  return lease.command.length > 0 ? lease.command.join(" ") : "";
}

function leaseRow(lease: LeaseCandidate): string {
  const limits = lease.sharedLimits.length > 0
    ? lease.sharedLimits.map((l) => `<span class="badge">${escape(l)}</span>`).join(" ")
    : `<span class="muted">none</span>`;
  const command = commandText(lease);
  return `
    <tr>
      <td><span class="badge ${escape(lease.status)}">${escape(lease.status)}</span></td>
      <td>
        <strong>${escape(lease.project)}</strong><br>
        <span>${escape(lease.title)}</span>
      </td>
      <td><code>${escape(lease.action)}</code><br><span class="muted">${escape(lease.subtree)}</span></td>
      <td><a href="${escape(fileUrl(lease.cwd))}">${escape(lease.cwd)}</a></td>
      <td>${command ? `<code>${escape(command)}</code>` : `<span class="muted">human / signal</span>`}</td>
      <td>${limits}</td>
      <td>${escape(lease.reason)}</td>
    </tr>`;
}

function table(title: string, leases: LeaseCandidate[], empty: string): string {
  if (leases.length === 0) {
    return `
      <section class="panel wide">
        <h2>${escape(title)}</h2>
        <p class="muted">${escape(empty)}</p>
      </section>`;
  }

  return `
    <section class="panel wide">
      <h2>${escape(title)}</h2>
      <table class="orchestrator-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Target</th>
            <th>Action</th>
            <th>CWD</th>
            <th>Command</th>
            <th>Limits</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>${leases.map(leaseRow).join("")}</tbody>
      </table>
    </section>`;
}

export function renderOrchestrator(projects: Project[], model: OrchestratorModel): string {
  const summary = `
    <div class="summary">
      <div class="summary-item"><div class="label">Granted</div><div class="value">${model.granted.length}</div></div>
      <div class="summary-item"><div class="label">Attention</div><div class="value">${model.attention.length}</div></div>
      <div class="summary-item"><div class="label">Ready</div><div class="value">${model.ready.length}</div></div>
      <div class="summary-item"><div class="label">Lease-blocked</div><div class="value">${model.blocked.length}</div></div>
    </div>`;

  const body = `
    <h1>Orchestrator</h1>
    <p class="muted">Deterministic central model across ${projects.length} projects. It grants parallel leases only when cwd, branch, roadmap item, and shared-resource limits do not conflict.</p>
    <p class="muted">Generated ${escape(model.generatedAt)}. Limits: ${escape(JSON.stringify(model.limits))}</p>
    ${summary}
    ${table("Granted Leases", model.granted, "No automated leases are currently grantable.")}
    ${table("Human Attention / Ready Signals", [...model.attention, ...model.ready], "No user attention or ready-for-user signals.")}
    ${table("Blocked By Lease Limits", model.blocked, "Nothing was blocked by lease conflicts or shared limits.")}
    ${table("All Candidates", model.all, "No PM or build candidates discovered.")}`;

  return layout({
    title: "Orchestrator — meta",
    body,
    breadcrumbs: [{ label: "projects", href: "/" }, { label: "orchestrator" }],
  });
}
