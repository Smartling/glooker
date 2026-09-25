import { NextRequest } from 'next/server';
import { withRequestLog } from '@/lib/logger';
import { getSummary } from '@/lib/vulnerabilities/queries';
import { withFilters } from '../_shared';

async function getHandler(req: NextRequest) { return withFilters(req, f => getSummary(f)); }
export const GET = withRequestLog(getHandler);
