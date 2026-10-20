/**
 * bundle.ts — a project file: the Project and its Model Configuration together,
 * as a `.json` holds them.
 */

import type { ModelConfiguration } from "./config";
import type { Project } from "./network";

export interface ProjectBundle {
  project: Project;
  config: ModelConfiguration;
}
