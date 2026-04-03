import type { JiraUser, JiraIssueData } from './client';

export interface JiraClientInterface {
  testConnection(): Promise<JiraUser>;
  findUserByEmail(email: string): Promise<JiraUser | null>;
  searchEpics(jql: string): Promise<Array<{
    key: string; summary: string; status: string; dueDate: string | null;
    assigneeDisplayName: string | null; assigneeEmail: string | null;
    parentKey: string | null; parentSummary: string | null; parentTypeName: string | null;
  }>>;
  searchChildIssues(epicKey: string): Promise<Array<{
    key: string; summary: string; status: string; statusCategory: string;
    resolvedAt: string | null; assigneeEmail: string | null;
  }>>;
  searchDoneIssues(
    accountId: string, periodDays: number,
    projects?: string[], storyPointsFields?: string[],
  ): Promise<JiraIssueData[]>;
  updateDueDate(issueKey: string, dueDate: string | null): Promise<void>;
}
