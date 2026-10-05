'use client';

import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: ReactNode;
  meta?: ReactNode;
  freshness?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}

/** Shared header block for the Org Summary, Team Summary and Vulnerabilities
 * dashboards: title + meta on the left, freshness/badges below, actions
 * right-aligned, with room for banners underneath (failed-run notices, etc). */
export default function PageHeader({ title, meta, freshness, badges, actions, children }: PageHeaderProps) {
  return (
    <div className="bg-gray-900 rounded-xl p-6 mb-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{title}</h1>
          {meta && <p className="text-gray-500 mt-1">{meta}</p>}
          {(freshness || badges) && (
            <div className="flex items-center gap-2 mt-1 text-xs">
              {freshness}
              {badges}
            </div>
          )}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
