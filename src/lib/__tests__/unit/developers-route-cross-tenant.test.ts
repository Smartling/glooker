/**
 * Integration tests for /api/developers cross-tenant authorization.
 *
 * Pentest finding: Authenticated users could read another hosted organization's
 * developer data by changing the `org` query parameter. The route validated only
 * against ALLOWED_ORGS (deployment-wide) but not against the authenticated user's
 * organization entitlements.
 *
 * Mitigation: requireUserOrg() now checks the user's JWT groups claim against
 * AUTH_USER_ORG_CLAIM pattern to enforce user-to-org authorization.
 */

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/developers/route';
import { extractUser } from '@/lib/auth';
import { listDevelopers, listDevelopersFromGitHub } from '@/lib/developers/service';

jest.mock('@/lib/auth', () => ({
  extractUser: jest.fn(),
  isAuthEnabled: jest.fn(),
}));

jest.mock('@/lib/developers/service', () => ({
  listDevelopers: jest.fn(),
  listDevelopersFromGitHub: jest.fn(),
}));

const KEYS = [
  'ALLOWED_ORGS',
  'AUTH_USER_ORG_CLAIM',
  'AUTH_ADMIN_GROUP',
  'AUTH_ENABLED',
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
  jest.clearAllMocks();
  
  const { isAuthEnabled } = require('@/lib/auth');
  isAuthEnabled.mockReturnValue(true);
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const req = (org: string, source?: string) => {
  const url = new URL(`http://localhost/api/developers?org=${org}`);
  if (source) url.searchParams.set('source', source);
  return new NextRequest(url);
};

describe('/api/developers — cross-tenant authorization', () => {
  describe('vulnerability reproduction (multi-org deployment without user-to-org auth)', () => {
    it('WITHOUT AUTH_USER_ORG_CLAIM: user can read any hosted org data (vulnerability still present)', async () => {
      // Multi-org deployment
      process.env.ALLOWED_ORGS = 'acme,victim-inc';
      // No user-to-org authorization configured (the vulnerability)
      delete process.env.AUTH_USER_ORG_CLAIM;

      // User authenticated and entitled to "acme"
      (extractUser as jest.Mock).mockResolvedValue({
        email: 'attacker@acme.com',
        sub: 'user123',
        name: 'Attacker',
        groups: ['org-acme'],
      });

      // Mock victim-inc's developer data
      (listDevelopers as jest.Mock).mockResolvedValue([
        { github_login: 'victim-dev', github_name: 'Victim Developer' },
      ]);

      // Attacker changes org parameter to victim-inc
      const response = await GET(req('victim-inc'));

      // WITHOUT AUTH_USER_ORG_CLAIM: This succeeds because requireUserOrg skips
      // the check when AUTH_USER_ORG_CLAIM is not configured (backward compatibility)
      // This demonstrates the vulnerability still exists without proper configuration
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual([
        { github_login: 'victim-dev', github_name: 'Victim Developer' },
      ]);
      
      // The service was called with the victim org
      expect(listDevelopers).toHaveBeenCalledWith('victim-inc', { query: undefined, limit: 0 });
    });

    it('WITH AUTH_USER_ORG_CLAIM: blocks cross-tenant read from database-backed developer listing', async () => {
      process.env.ALLOWED_ORGS = 'acme,victim-inc';
      // Enable user-to-org authorization (the fix)
      process.env.AUTH_USER_ORG_CLAIM = 'org-';

      (extractUser as jest.Mock).mockResolvedValue({
        email: 'user@acme.com',
        sub: 'user123',
        name: 'User',
        groups: ['org-acme'],
      });

      (listDevelopers as jest.Mock).mockResolvedValue([
        { github_login: 'victim-dev', github_name: 'Victim' },
      ]);

      const response = await GET(req('victim-inc'));
      expect(response.status).toBe(404);
      expect(listDevelopers).not.toHaveBeenCalled();
    });

    it('WITH AUTH_USER_ORG_CLAIM: blocks cross-tenant read from live GitHub membership lookup', async () => {
      process.env.ALLOWED_ORGS = 'acme,victim-inc';
      // Enable user-to-org authorization (the fix)
      process.env.AUTH_USER_ORG_CLAIM = 'org-';

      (extractUser as jest.Mock).mockResolvedValue({
        email: 'user@acme.com',
        sub: 'user123',
        name: 'User',
        groups: ['org-acme'],
      });

      (listDevelopersFromGitHub as jest.Mock).mockResolvedValue([
        { github_login: 'victim-dev', github_name: 'Victim' },
      ]);

      const response = await GET(req('victim-inc', 'github'));
      expect(response.status).toBe(404);
      expect(listDevelopersFromGitHub).not.toHaveBeenCalled();
    });
  });

  describe('mitigation: user-to-org authorization with AUTH_USER_ORG_CLAIM', () => {
    it('allows access when user has matching org group (prefix pattern)', async () => {
      process.env.ALLOWED_ORGS = 'acme,other-org';
      process.env.AUTH_USER_ORG_CLAIM = 'org-';

      (extractUser as jest.Mock).mockResolvedValue({
        email: 'user@acme.com',
        sub: 'user123',
        name: 'User',
        groups: ['org-acme', 'other-group'],
      });

      (listDevelopers as jest.Mock).mockResolvedValue([
        { github_login: 'acme-dev', github_name: 'Acme Developer' },
      ]);

      const response = await GET(req('acme'));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual([
        { github_login: 'acme-dev', github_name: 'Acme Developer' },
      ]);
      expect(listDevelopers).toHaveBeenCalledWith('acme', { query: undefined, limit: 0 });
    });

    it('denies access when user lacks matching org group (prefix pattern)', async () => {
      process.env.ALLOWED_ORGS = 'acme,victim-inc';
      process.env.AUTH_USER_ORG_CLAIM = 'org-';

      (extractUser as jest.Mock).mockResolvedValue({
        email: 'user@acme.com',
        sub: 'user123',
        name: 'User',
        groups: ['org-acme'],
      });

      const response = await GET(req('victim-inc'));
      expect(response.status).toBe(404);
      expect(listDevelopers).not.toHaveBeenCalled();
    });

    it('allows access when user has matching org group (exact match pattern)', async () => {
      process.env.ALLOWED_ORGS = 'acme,other-org';
      // Use a non-dash pattern for exact match (e.g., just a marker like "exact")
      // The implementation treats any non-dash-ending string as exact match
      process.env.AUTH_USER_ORG_CLAIM = 'x';

      (extractUser as jest.Mock).mockResolvedValue({
        email: 'user@acme.com',
        sub: 'user123',
        name: 'User',
        groups: ['acme', 'other-group'],
      });

      (listDevelopers as jest.Mock).mockResolvedValue([
        { github_login: 'acme-dev', github_name: 'Acme Developer' },
      ]);

      const response = await GET(req('acme'));
      expect(response.status).toBe(200);
      expect(listDevelopers).toHaveBeenCalledWith('acme', { query: undefined, limit: 0 });
    });

    it('denies access when user lacks matching org group (exact match pattern)', async () => {
      process.env.ALLOWED_ORGS = 'acme,victim-inc';
      // Use a non-dash pattern for exact match
      process.env.AUTH_USER_ORG_CLAIM = 'x';

      (extractUser as jest.Mock).mockResolvedValue({
        email: 'user@acme.com',
        sub: 'user123',
        name: 'User',
        groups: ['acme'],
      });

      const response = await GET(req('victim-inc'));
      expect(response.status).toBe(404);
      expect(listDevelopers).not.toHaveBeenCalled();
    });

    it('performs case-insensitive org matching', async () => {
      process.env.ALLOWED_ORGS = 'acme';
      process.env.AUTH_USER_ORG_CLAIM = 'org-';

      (extractUser as jest.Mock).mockResolvedValue({
        email: 'user@acme.com',
        sub: 'user123',
        name: 'User',
        groups: ['org-ACME'],
      });

      (listDevelopers as jest.Mock).mockResolvedValue([]);

      const response = await GET(req('acme'));
      expect(response.status).toBe(200);
      expect(listDevelopers).toHaveBeenCalled();
    });

    it('allows admins to access any org', async () => {
      process.env.ALLOWED_ORGS = 'acme,victim-inc';
      process.env.AUTH_USER_ORG_CLAIM = 'org-';
      process.env.AUTH_ADMIN_GROUP = 'admin-group';

      (extractUser as jest.Mock).mockResolvedValue({
        email: 'admin@example.com',
        sub: 'admin123',
        name: 'Admin',
        groups: ['admin-group'],
      });

      (listDevelopers as jest.Mock).mockResolvedValue([
        { github_login: 'victim-dev', github_name: 'Victim Developer' },
      ]);

      const response = await GET(req('victim-inc'));
      expect(response.status).toBe(200);
      expect(listDevelopers).toHaveBeenCalledWith('victim-inc', { query: undefined, limit: 0 });
    });

    it('returns 404 (not 403) to avoid org enumeration', async () => {
      process.env.ALLOWED_ORGS = 'acme,victim-inc';
      process.env.AUTH_USER_ORG_CLAIM = 'org-';

      (extractUser as jest.Mock).mockResolvedValue({
        email: 'user@acme.com',
        sub: 'user123',
        name: 'User',
        groups: ['org-acme'],
      });

      const response = await GET(req('victim-inc'));
      expect(response.status).toBe(404);
      const body = await response.json();
      // Should not leak the org name in the error message
      expect(JSON.stringify(body)).not.toContain('victim-inc');
    });
  });

  describe('backward compatibility: single-org deployments', () => {
    it('allows access when AUTH_USER_ORG_CLAIM is not configured (single-org mode)', async () => {
      process.env.ALLOWED_ORGS = 'acme';
      delete process.env.AUTH_USER_ORG_CLAIM;

      (extractUser as jest.Mock).mockResolvedValue({
        email: 'user@acme.com',
        sub: 'user123',
        name: 'User',
        groups: ['some-group'],
      });

      (listDevelopers as jest.Mock).mockResolvedValue([
        { github_login: 'acme-dev', github_name: 'Acme Developer' },
      ]);

      const response = await GET(req('acme'));
      expect(response.status).toBe(200);
      expect(listDevelopers).toHaveBeenCalled();
    });

    it('allows access when auth is disabled', async () => {
      const { isAuthEnabled } = require('@/lib/auth');
      isAuthEnabled.mockReturnValue(false);

      process.env.ALLOWED_ORGS = 'acme';
      process.env.AUTH_USER_ORG_CLAIM = 'org-';

      (listDevelopers as jest.Mock).mockResolvedValue([
        { github_login: 'acme-dev', github_name: 'Acme Developer' },
      ]);

      const response = await GET(req('acme'));
      expect(response.status).toBe(200);
      expect(listDevelopers).toHaveBeenCalled();
    });
  });

  describe('defense in depth: ALLOWED_ORGS still enforced', () => {
    it('denies access to org not in ALLOWED_ORGS even with matching user group', async () => {
      process.env.ALLOWED_ORGS = 'acme';
      process.env.AUTH_USER_ORG_CLAIM = 'org-';

      (extractUser as jest.Mock).mockResolvedValue({
        email: 'user@example.com',
        sub: 'user123',
        name: 'User',
        groups: ['org-external-org'],
      });

      const response = await GET(req('external-org'));
      expect(response.status).toBe(404);
      expect(listDevelopers).not.toHaveBeenCalled();
    });

    it('validates org syntax before checking user authorization', async () => {
      process.env.ALLOWED_ORGS = 'acme';
      process.env.AUTH_USER_ORG_CLAIM = 'org-';

      (extractUser as jest.Mock).mockResolvedValue({
        email: 'user@acme.com',
        sub: 'user123',
        name: 'User',
        groups: ['org-acme'],
      });

      // Invalid org syntax
      const response = await GET(req('../../etc/passwd'));
      expect(response.status).toBe(404);
      expect(listDevelopers).not.toHaveBeenCalled();
    });
  });

  describe('both data sources protected', () => {
    it('protects database-backed developer listing', async () => {
      process.env.ALLOWED_ORGS = 'acme,victim-inc';
      process.env.AUTH_USER_ORG_CLAIM = 'org-';

      (extractUser as jest.Mock).mockResolvedValue({
        email: 'user@acme.com',
        sub: 'user123',
        name: 'User',
        groups: ['org-acme'],
      });

      (listDevelopers as jest.Mock).mockResolvedValue([
        { github_login: 'victim-dev', github_name: 'Victim' },
      ]);

      // Default source (database)
      const response = await GET(req('victim-inc'));
      expect(response.status).toBe(404);
      expect(listDevelopers).not.toHaveBeenCalled();
    });

    it('protects live GitHub membership lookup', async () => {
      process.env.ALLOWED_ORGS = 'acme,victim-inc';
      process.env.AUTH_USER_ORG_CLAIM = 'org-';

      (extractUser as jest.Mock).mockResolvedValue({
        email: 'user@acme.com',
        sub: 'user123',
        name: 'User',
        groups: ['org-acme'],
      });

      (listDevelopersFromGitHub as jest.Mock).mockResolvedValue([
        { github_login: 'victim-dev', github_name: 'Victim' },
      ]);

      // GitHub source
      const response = await GET(req('victim-inc', 'github'));
      expect(response.status).toBe(404);
      expect(listDevelopersFromGitHub).not.toHaveBeenCalled();
    });

    it('allows authorized access to GitHub source', async () => {
      process.env.ALLOWED_ORGS = 'acme';
      process.env.AUTH_USER_ORG_CLAIM = 'org-';

      (extractUser as jest.Mock).mockResolvedValue({
        email: 'user@acme.com',
        sub: 'user123',
        name: 'User',
        groups: ['org-acme'],
      });

      (listDevelopersFromGitHub as jest.Mock).mockResolvedValue([
        { github_login: 'acme-dev', github_name: 'Acme Developer' },
      ]);

      const response = await GET(req('acme', 'github'));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual([
        { github_login: 'acme-dev', github_name: 'Acme Developer' },
      ]);
      expect(listDevelopersFromGitHub).toHaveBeenCalledWith('acme', undefined);
    });
  });

  describe('query parameters preserved after authorization', () => {
    it('passes query parameter to service after authorization', async () => {
      process.env.ALLOWED_ORGS = 'acme';
      process.env.AUTH_USER_ORG_CLAIM = 'org-';

      (extractUser as jest.Mock).mockResolvedValue({
        email: 'user@acme.com',
        sub: 'user123',
        name: 'User',
        groups: ['org-acme'],
      });

      (listDevelopers as jest.Mock).mockResolvedValue([]);

      const url = new URL('http://localhost/api/developers?org=acme&q=john&limit=10');
      const response = await GET(new NextRequest(url));
      
      expect(response.status).toBe(200);
      expect(listDevelopers).toHaveBeenCalledWith('acme', { query: 'john', limit: 10 });
    });
  });
});
