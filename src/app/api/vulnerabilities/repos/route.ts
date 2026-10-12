import { NextRequest } from 'next/server';
import { withRequestLog } from '@/lib/logger';
import { getRepos } from '@/lib/vulnerabilities/queries';
import { withFilters } from '../_shared';

async function getHandler(req: NextRequest) { return withFilters(req, f => getRepos(f)); }
export const GET = withRequestLog(getHandler);
