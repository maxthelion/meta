export interface ProjectConfig {
  name: string;
  path: string;
  status?: "active" | "dormant" | "archived";
}

export interface HubConfig {
  port: number;
  "dev-root": string;
  projects: ProjectConfig[];
}

export interface ProjectManifest {
  name?: string;
  description?: string;
  status?: "active" | "dormant" | "archived";
  plugins?: string[];
  actions?: Record<string, string>;
  [key: string]: unknown;
}

export interface Project {
  name: string;
  slug: string;
  path: string;
  status: "active" | "dormant" | "archived";
  description?: string;
  manifest: ProjectManifest;
  plugins: string[];
}

export interface ActionDef {
  id: string;
  label: string;
  fields: ActionField[];
}

export interface ActionField {
  name: string;
  label: string;
  type: "text" | "textarea" | "select";
  required?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
}

export interface ActionRequest {
  project: Project;
  action: string;
  values: Record<string, string>;
}

export interface ActionResult {
  ok: boolean;
  output: string;
  redirectTo?: string;
}

export interface PluginContext {
  project: Project;
}

export interface Plugin {
  id: string;
  label: string;
  detect(project: Project): boolean | Promise<boolean>;
  render(ctx: PluginContext): string | Promise<string>;
  summary?(ctx: PluginContext): string | Promise<string>;
  actions?(project: Project): ActionDef[];
  handleAction?(req: ActionRequest): Promise<ActionResult>;
}
