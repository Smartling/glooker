'use client';

import { useState, useEffect } from 'react';

export default function DebugHeadersPage() {
  const [data, setData] = useState<{ headers: Record<string, string>; timestamp: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/debug/headers')
      .then(r => r.json())
      .then(setData)
      .catch(e => setError(e.message));
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-4 py-16 font-mono text-sm">
      <h1 className="text-xl font-bold text-white mb-2">Request Headers</h1>
      <p className="text-gray-500 mb-6 text-xs">Debug page — not linked from navigation</p>

      {error && <p className="text-red-400">Error: {error}</p>}

      {data && (
        <>
          <p className="text-gray-500 mb-4">Timestamp: {data.timestamp}</p>
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left py-2 pr-4 text-gray-500 w-1/3">Header</th>
                <th className="text-left py-2 text-gray-500">Value</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.headers)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, value]) => (
                  <tr key={key} className="border-b border-gray-800/50">
                    <td className="py-1.5 pr-4 text-accent-light whitespace-nowrap">{key}</td>
                    <td className="py-1.5 text-gray-300 break-all">{value}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}

      {!data && !error && <p className="text-gray-500">Loading...</p>}
    </div>
  );
}
