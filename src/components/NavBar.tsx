'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '@/app/auth-context';

interface LatestReport {
  id: string;
  date: string;
  org: string;
}

export default function NavBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { enabled: authEnabled, user } = useAuth();
  const [latestReport, setLatestReport] = useState<LatestReport | null>(null);
  const [projectsEnabled, setProjectsEnabled] = useState(false);

  useEffect(() => {
    fetch('/api/llm-config')
      .then(r => r.json())
      .then(d => {
        setLatestReport(d.latestReport ?? null);
        setProjectsEnabled(Boolean(d.jira?.enabled && d.jira?.projectsJql));
      })
      .catch(() => {});
  }, []);

  const isReportPage = pathname.match(/^\/report\/[^/]+\//);
  const isDevDetail = pathname.match(/^\/report\/[^/]+\/dev\//);
  const isOrgView = searchParams.get('view') === 'org';

  const isTeamPage = pathname.match(/^\/report\/[^/]+\/team/);
  const isTeamActive = Boolean(isTeamPage || isDevDetail);
  const isOrgActive = Boolean(isReportPage && !isTeamPage && !isDevDetail);

  const navItemClass = (active: boolean, disabled: boolean = false) =>
    `px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
      disabled
        ? 'text-gray-700 cursor-not-allowed'
        : active
          ? 'text-accent-light bg-accent/10 font-semibold'
          : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
    }`;

  const isHomeActive = pathname === '/' || pathname === '';

  const teamUrl = latestReport ? `/report/${latestReport.id}/team` : null;
  const orgUrl = latestReport ? `/report/${latestReport.id}/org` : null;

  return (
    <nav className="bg-gray-900 border-b border-gray-800/80 px-5 flex items-center h-12 gap-1 no-print">
      {/* Logo */}
      <Link href="/" className="font-bold text-[15px] text-gray-100 mr-6 tracking-tight hover:text-white transition-colors shrink-0">
        <span className="text-accent-light">G</span>looker
      </Link>

      {/* Primary nav */}
      <div className="flex items-center gap-0.5 flex-1 min-w-0">
        <Link href="/" className={navItemClass(isHomeActive)}>
          Home
        </Link>

        {teamUrl ? (
          <Link href={teamUrl} className={navItemClass(isTeamActive)}>
            Team Summary <span className="text-gray-600 text-[10px] ml-1">{latestReport?.date}</span>
          </Link>
        ) : (
          <span className={navItemClass(false, true)}>
            Team Summary
          </span>
        )}

        {orgUrl ? (
          <Link href={orgUrl} className={navItemClass(isOrgActive)}>
            Org Summary <span className="text-gray-600 text-[10px] ml-1">{latestReport?.date}</span>
          </Link>
        ) : (
          <span className={navItemClass(false, true)}>
            Org Summary
          </span>
        )}

        {projectsEnabled && (
          <Link href="/projects" className={navItemClass(pathname.startsWith('/projects'))}>
            Projects
          </Link>
        )}

        <Link href="/reports" className={navItemClass(pathname.startsWith('/reports'))}>
          Report History
        </Link>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2 shrink-0">
        <Link href="/settings" className={`p-2 rounded-md transition-colors ${pathname.startsWith('/settings') ? 'text-accent-light bg-accent/10' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'}`}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </Link>
        {authEnabled && user && (
          <Link href="/profile" className={`flex items-center pl-1 pr-2.5 py-1 rounded-full transition-colors ${pathname.startsWith('/profile') ? 'bg-accent/10' : 'hover:bg-gray-800/50'}`}>
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="w-7 h-7 rounded-full border border-gray-700" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-xs text-gray-400">
                {(user.name || user.email)[0].toUpperCase()}
              </div>
            )}
          </Link>
        )}
      </div>
    </nav>
  );
}
