'use client';

import { useAuth } from '../auth-context';
import { useRouter } from 'next/navigation';

export default function ProfileContent() {
  const auth = useAuth();
  const router = useRouter();

  if (auth.loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16">
        <div className="animate-pulse bg-gray-900 rounded-xl p-8 h-48" />
      </div>
    );
  }

  if (!auth.user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center text-gray-500">
        No user identity found.
      </div>
    );
  }

  const user = auth.user;

  return (
    <div className="max-w-2xl mx-auto px-4 py-16">
      <button
        onClick={() => router.push('/')}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 mb-8 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      <div className="bg-gray-900 rounded-xl p-8 border border-gray-800">
        <div className="flex items-center gap-5 mb-6">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="w-20 h-20 rounded-full border-2 border-gray-700" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-gray-700 flex items-center justify-center text-2xl text-gray-400">
              {(user.name || user.email)[0].toUpperCase()}
            </div>
          )}
          <div>
            {user.name && <h1 className="text-xl font-bold text-white">{user.name}</h1>}
            <p className="text-gray-400">{user.email}</p>
          </div>
        </div>

        <div className="space-y-4 border-t border-gray-800 pt-6">
          {user.githubLogin && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">GitHub</span>
              <span className="text-sm text-gray-300">{user.githubLogin}</span>
            </div>
          )}
          {user.team && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Team</span>
              <span className="text-sm text-gray-300 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: user.team.color }} />
                {user.team.name}
              </span>
            </div>
          )}
          {auth.user.role && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Role</span>
              <span className="text-sm text-gray-300 capitalize">{auth.user.role}</span>
            </div>
          )}
        </div>

        <p className="text-xs text-gray-600 mt-8">
          Identity provided by your organization&apos;s identity provider
        </p>
      </div>
    </div>
  );
}
