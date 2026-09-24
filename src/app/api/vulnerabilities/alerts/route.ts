import { NextRequest } from 'next/server';
import { withRequestLog } from '@/lib/logger';
import { getAlerts } from '@/lib/vulnerabilities/queries';
import { withFilters } from '../_shared';

async function getHandler(req: NextRequest) { return withFilters(req, f => getAlerts(f)); }
export const GET = withRequestLog(getHandler);
