'use client';

export default function Footer() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION;
  const sha = process.env.NEXT_PUBLIC_COMMIT_SHA;

  return (
    <footer className="border-t border-gray-800 py-4 text-center text-xs text-gray-500">
      v{version}{sha ? ` (${sha})` : ''}
    </footer>
  );
}
