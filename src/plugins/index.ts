import type { Plugin } from "../types.ts";
import { roadmapPlugin } from "./roadmap.ts";
import { skillsPlugin } from "./skills.ts";
import { agentsPlugin } from "./agents.ts";

export const plugins: Plugin[] = [
  roadmapPlugin,
  skillsPlugin,
  agentsPlugin,
];
