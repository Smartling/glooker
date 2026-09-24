import { notFound } from 'next/navigation';
import VulnerabilitiesContent from './vulnerabilities-content';

export const dynamic = 'force-dynamic';

export default function VulnerabilitiesPage() {
  if (!process.env.VULNERABILITIES_ORG?.trim()) notFound();
  return <VulnerabilitiesContent />;
}
