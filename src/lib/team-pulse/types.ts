// src/lib/team-pulse/types.ts
//
// Shared types for the team-pulse Current Projects feature (GLOOK-11).
// Lives in its own file so service.ts, projects.ts, and the React
// component can all import without circular deps.

export interface TeamProject {
  /** LLM-generated descriptive name, e.g. "Multi-tenant Jobs UI" */
  name: string;
  /** One-line summary of what the project is about */
  summary: string;
  /** GitHub logins of the team members contributing to the project.
   *  Guaranteed to be a non-empty subset of the team's members. */
  developers: string[];
  /** Distinct Jira issue count attributed to the cluster */
  jira_count: number;
  /** Approximate commit count attributed to the cluster */
  estimated_commits: number;
  /** Approximate PR count attributed to the cluster */
  estimated_prs: number;
  /** ISO date of the most recent commit in the cluster */
  last_activity: string;
}
