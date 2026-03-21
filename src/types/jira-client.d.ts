declare module 'jira-client' {
  interface JiraApiOptions {
    protocol?: string;
    host: string;
    username?: string;
    password?: string;
    apiVersion?: string;
    strictSSL?: boolean;
    bearer?: string;
    timeout?: number;
  }

  interface SearchResult {
    total: number;
    startAt: number;
    maxResults: number;
    issues: Array<{
      key: string;
      fields: Record<string, any>;
    }>;
  }

  interface JiraUser {
    accountId: string;
    displayName: string;
    emailAddress?: string;
    active: boolean;
  }

  class JiraApi {
    constructor(options: JiraApiOptions);
    searchJira(jql: string, options?: { startAt?: number; maxResults?: number; fields?: string[] }): Promise<SearchResult>;
    getCurrentUser(): Promise<JiraUser>;
    searchUsers(opts: { query: string; maxResults?: number }): Promise<JiraUser[]>;
  }

  export default JiraApi;
}
