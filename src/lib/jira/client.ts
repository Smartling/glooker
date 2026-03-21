export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  active: boolean;
}

export interface JiraIssueData {
  issueKey: string;
  projectKey: string;
  issueType: string | null;
  summary: string | null;
  description: string | null;
  status: string | null;
  labels: string[];
  storyPoints: number | null;
  originalEstimateSeconds: number | null;
  issueUrl: string;
  createdAt: string | null;
  resolvedAt: string | null;
}

export function buildDoneIssuesJql(
  accountId: string,
  periodDays: number,
  projects?: string[],
): string {
  const parts = [
    `assignee = "${accountId}"`,
    'statusCategory = "Done"',
    `resolved >= -${periodDays}d`,
  ];
  if (projects && projects.length > 0) {
    const quoted = projects.map(p => `"${p}"`).join(',');
    parts.push(`project IN (${quoted})`);
  }
  return parts.join(' AND ') + ' ORDER BY resolved DESC';
}

export class JiraClient {
  private host: string;
  private protocol: string;
  private apiVersion: string;
  private authHeader: string;

  constructor(host: string, username: string, apiToken: string, apiVersion = '3') {
    const isHttps = !host.includes('localhost') && !host.startsWith('http://');
    this.protocol = isHttps ? 'https' : 'http';
    this.host = host.replace(/^https?:\/\//, '');
    this.apiVersion = apiVersion;
    this.authHeader = 'Basic ' + Buffer.from(`${username}:${apiToken}`).toString('base64');
  }

  private get baseUrl(): string {
    return `${this.protocol}://${this.host}/rest/api/${this.apiVersion}`;
  }

  private async jiraFetch<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...options?.headers,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Jira API error (${res.status}): ${text}`);
    }
    return res.json();
  }

  async testConnection(): Promise<JiraUser> {
    return this.jiraFetch<JiraUser>('/myself');
  }

  async findUserByEmail(email: string): Promise<JiraUser | null> {
    const results = await this.jiraFetch<JiraUser[]>(
      `/user/search?query=${encodeURIComponent(email)}&maxResults=10`,
    );
    const match = results.find(
      (u) => u.emailAddress?.toLowerCase() === email.toLowerCase() && u.active,
    );
    if (!match && results.length > 0 && results.every((u) => !u.emailAddress)) {
      console.warn(
        `[jira] User search for "${email}" returned ${results.length} results but none have emailAddress — email visibility may be restricted`,
      );
    }
    return match || null;
  }

  private async searchJql(
    jql: string,
    fields: string[],
    maxResults: number,
    nextPageToken?: string,
  ): Promise<{ total: number; nextPageToken?: string; issues: Array<{ key: string; fields: Record<string, any> }> }> {
    const body: Record<string, any> = { jql, fields, maxResults };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    return this.jiraFetch('/search/jql', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async searchDoneIssues(
    accountId: string,
    periodDays: number,
    projects?: string[],
  ): Promise<JiraIssueData[]> {
    const jql = buildDoneIssuesJql(accountId, periodDays, projects);
    const fields = [
      'summary', 'description', 'status', 'issuetype', 'labels',
      'customfield_10016', 'timeoriginalestimate', 'created', 'resolutiondate',
    ];

    const allIssues: JiraIssueData[] = [];
    const maxResults = 50;
    let nextPageToken: string | undefined;

    while (true) {
      const result = await this.searchJql(jql, fields, maxResults, nextPageToken);

      for (const issue of result.issues) {
        const f = issue.fields;
        allIssues.push({
          issueKey: issue.key,
          projectKey: issue.key.split('-')[0],
          issueType: f.issuetype?.name || null,
          summary: f.summary || null,
          description: typeof f.description === 'string'
            ? f.description.slice(0, 2000)
            : (f.description?.content ? '[ADF content]' : null),
          status: f.status?.name || null,
          labels: f.labels || [],
          storyPoints: f.customfield_10016 != null ? Number(f.customfield_10016) : null,
          originalEstimateSeconds: f.timeoriginalestimate || null,
          issueUrl: `${this.protocol}://${this.host}/browse/${issue.key}`,
          createdAt: f.created || null,
          resolvedAt: f.resolutiondate || null,
        });
      }

      if (!result.nextPageToken || result.issues.length < maxResults) break;
      nextPageToken = result.nextPageToken;
      await new Promise(r => setTimeout(r, 1000));
    }

    return allIssues;
  }
}

let cachedClient: JiraClient | null = null;

export function getJiraClient(): JiraClient | null {
  if (process.env.JIRA_ENABLED !== 'true') return null;
  if (!process.env.JIRA_HOST || !process.env.JIRA_USERNAME || !process.env.JIRA_API_TOKEN) return null;

  if (!cachedClient) {
    cachedClient = new JiraClient(
      process.env.JIRA_HOST,
      process.env.JIRA_USERNAME,
      process.env.JIRA_API_TOKEN,
      process.env.JIRA_API_VERSION || '3',
    );
  }
  return cachedClient;
}
