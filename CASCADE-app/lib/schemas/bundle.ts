/**
 * bundle.ts — a project file: the Project and its Model Configuration together,
 * as a `.json` holds them and a Workbook holds them (ADR-0023).
 */

import type { ModelConfiguration } from "./config";
import type { Project } from "./network";

export interface ProjectBundle {
  project: Project;
  config: ModelConfiguration;
}
