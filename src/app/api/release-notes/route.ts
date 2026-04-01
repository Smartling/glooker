import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getLLMClient, LLM_MODEL, extraBodyProps, tokenLimit } from '@/lib/llm-provider';

const REPO_OWNER = 'Smartling';
const REPO_NAME = 'glooker';
const DAYS = 14;

export async function GET() {
  try {
    // Fetch recent commits from GitHub
    const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();
    const ghToken = process.env.GITHUB_TOKEN;
    if (!ghToken) return NextResponse.json({ available: false });

    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits?since=${since}&per_page=100`,
      { headers: { Authorization: `token ${ghToken}`, Accept: 'application/vnd.github.v3+json' }, next: { revalidate: 3600 } },
    );

    if (!res.ok) return NextResponse.json({ available: false });

    const commits = await res.json();
    if (!Array.isArray(commits) || commits.length === 0) {
      return NextResponse.json({ available: false });
    }

    const latestSha = commits[0].sha;

    // Check cache — if we already have notes for this commit, return them
    const [cached] = await db.execute(
      `SELECT summary, commit_count, generated_at FROM release_notes WHERE latest_commit_sha = ?`,
      [latestSha],
    ) as [any[], any];

    if (cached.length > 0) {
      return NextResponse.json({
        available: true,
        summary: cached[0].summary,
        commitCount: cached[0].commit_count,
        generatedAt: cached[0].generated_at,
        latestSha,
        cached: true,
      });
    }

    // Build commit list for LLM
    const commitList = commits
      .map((c: any) => `- ${c.commit.message.split('\n')[0]}`)
      .join('\n');

    const client = await getLLMClient();
    const response = await client.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.3,
      ...tokenLimit(512),
      messages: [
        {
          role: 'system',
          content: `You are a technical writer producing concise release notes for Glooker, a developer impact analytics tool. Write 3-6 bullet points summarizing the most notable changes. Each bullet should be one short sentence. Group related commits. Skip merge commits, version bumps, and trivial changes. Use past tense ("Added", "Fixed", "Improved"). Return plain text with bullet points using "•" character, no markdown.`,
        },
        {
          role: 'user',
          content: `Here are the ${commits.length} commits from the last ${DAYS} days:\n\n${commitList}`,
        },
      ],
      ...extraBodyProps(),
    } as any);

    const summary = (response.choices[0].message.content || '').trim();

    // Cache in DB
    await db.execute(
      `INSERT INTO release_notes (latest_commit_sha, summary, commit_count)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE summary = VALUES(summary), commit_count = VALUES(commit_count), generated_at = NOW()`,
      [latestSha, summary, commits.length],
    );

    return NextResponse.json({
      available: true,
      summary,
      commitCount: commits.length,
      generatedAt: new Date().toISOString(),
      latestSha,
      cached: false,
    });
  } catch (err) {
    console.error('[release-notes]', err);
    return NextResponse.json({ available: false });
  }
}
