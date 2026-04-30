import type { Plugin } from "../types.ts";
import { roadmapPlugin } from "./roadmap.ts";
import { skillsPlugin } from "./skills.ts";
import { agentsPlugin } from "./agents.ts";
import { gitPlugin } from "./git.ts";
import { wikiPlugin } from "./wiki.ts";

export const plugins: Plugin[] = [
  roadmapPlugin,
  skillsPlugin,
  agentsPlugin,
  wikiPlugin,
  gitPlugin,
];
