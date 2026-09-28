'use client';
import { Suspense } from 'react';
import ReportsTabs from './reports-tabs';

export default function RunsPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-white">Runs</h1>
        <p className="text-xs text-gray-500 mt-0.5">History of report runs and data syncs</p>
      </div>
      <Suspense fallback={null}>
        <ReportsTabs />
      </Suspense>
    </div>
  );
}
