import { PROJECT_KEY_RE, JiraProjectError, type JiraProject, type BoardTabKind } from './types';

/** One Done semantic for every project: filtering on last-updated rather than
 *  resolution date also catches rejected work, which carries no resolved date. */
export const DONE_WINDOW_DAYS = 30;

export function buildProjectJql(project: JiraProject, tab: BoardTabKind): string {
  if (!PROJECT_KEY_RE.test(project.projectKey)) {
    throw new JiraProjectError(`buildProjectJql received an invalid projectKey: ${project.projectKey}`);
  }
  const base = `project = "${project.projectKey}" AND issuetype = Epic`;

  switch (tab) {
    case 'active': {
      if (project.activeStatus.includes('"')) {
        throw new JiraProjectError(`buildProjectJql received an invalid activeStatus: ${project.activeStatus}`);
      }
      return `${base} AND status = "${project.activeStatus}"`;
    }
    case 'middle': {
      if (!project.middleStatus) {
        throw new JiraProjectError(`Project ${project.projectKey} has no middle tab`);
      }
      if (project.middleStatus.includes('"')) {
        throw new JiraProjectError(`buildProjectJql received an invalid middleStatus: ${project.middleStatus}`);
      }
      return `${base} AND status = "${project.middleStatus}"`;
    }
    case 'done':
      return `${base} AND statusCategory = "Done" AND updated >= -${DONE_WINDOW_DAYS}d`;
  }
}
