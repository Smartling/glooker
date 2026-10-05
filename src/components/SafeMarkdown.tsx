'use client';

import React from 'react';

/**
 * The single renderer for LLM-generated narrative text.
 *
 * Four components previously pushed model output straight into
 * `dangerouslySetInnerHTML` after applying a few markdown regexes —
 * report/[id]/dev/[login]/page.tsx, report/[id]/team/page.tsx and two sites in
 * chat-panel.tsx. None escaped `<`, `>` or `&`.
 *
 * The content reaching them derives from commit messages, PR titles, branch
 * names and Jira summaries, all writable by anyone who can push to a scanned
 * repo or file a ticket, and the dev summary is persisted to
 * `developer_summaries` — so one successful injection was served to every later
 * viewer, including admins, with no CSP to contain it and no CSRF token to stop
 * the resulting script driving admin routes.
 *
 * This returns React elements rather than an HTML string, so the text nodes are
 * escaped by React and there is no path by which a tag in the model's output
 * becomes a tag in the DOM. The markdown vocabulary supported is exactly what
 * those four call sites used: `## heading`, `- bullet`, `**bold**`, `` `code` ``
 * and `@mention`.
 *
 * Keeping it in one place is the point. The hardening on the prompt side was
 * uneven precisely because every call site re-invented it; a renderer that all
 * narrative surfaces share means the next one inherits the fix.
 */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|@[\w][\w-]*)/g;

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  return text
    .split(INLINE)
    .filter((tok) => tok !== '' && tok !== undefined)
    .map((tok, i) => {
      const k = `${keyPrefix}-${i}`;
      if (tok.length > 4 && tok.startsWith('**') && tok.endsWith('**')) {
        return <strong key={k} className="text-white">{tok.slice(2, -2)}</strong>;
      }
      if (tok.length > 2 && tok.startsWith('`') && tok.endsWith('`')) {
        return (
          <code key={k} className="bg-gray-700 px-1 rounded text-[11px]">{tok.slice(1, -1)}</code>
        );
      }
      if (tok.startsWith('@')) {
        return <span key={k} className="text-accent-light font-medium">{tok}</span>;
      }
      // Plain string: React escapes it on render.
      return tok;
    });
}

export interface SafeMarkdownProps {
  children: string | null | undefined;
  /** Render blank lines as paragraph breaks (dev summary / team pulse style). */
  paragraphs?: boolean;
  className?: string;
}

export default function SafeMarkdown({ children, paragraphs = true, className }: SafeMarkdownProps) {
  if (!children) return null;

  const lines = String(children).split('\n');
  const out: React.ReactNode[] = [];
  let bullets: React.ReactNode[] = [];

  const flushBullets = () => {
    if (!bullets.length) return;
    out.push(<ul key={`ul-${out.length}`} className="list-none space-y-1 my-2">{bullets}</ul>);
    bullets = [];
  };

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();

    if (line.startsWith('## ')) {
      flushBullets();
      out.push(
        <h3 key={`h-${i}`} className="text-xs font-bold uppercase tracking-wider text-gray-400 mt-4 mb-2">
          {renderInline(line.slice(3), `h${i}`)}
        </h3>,
      );
      return;
    }

    if (line.startsWith('- ')) {
      bullets.push(
        <li key={`li-${i}`} className="flex gap-1.5 items-start text-gray-300">
          <span className="text-gray-600 mt-0.5" aria-hidden="true">•</span>
          <span>{renderInline(line.slice(2), `li${i}`)}</span>
        </li>,
      );
      return;
    }

    flushBullets();

    if (line.trim() === '') {
      if (paragraphs) out.push(<div key={`sp-${i}`} className="h-3" />);
      return;
    }

    out.push(<p key={`p-${i}`} className="mb-2 last:mb-0">{renderInline(line, `p${i}`)}</p>);
  });

  flushBullets();

  return <div className={className}>{out}</div>;
}
