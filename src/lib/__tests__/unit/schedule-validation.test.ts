import { validateScheduleBody } from '@/lib/schedule/validation';
import { _clearOrgCache } from '@/lib/orgs/guard';

describe('validateScheduleBody', () => {
  const valid = {
    org: 'my-org',
    periodDays: 14,
    cronExpr: '0 9 * * 1',
    timezone: 'America/New_York',
  };

  const savedAllowedOrgs = process.env.ALLOWED_ORGS;
  
  beforeEach(() => {
    delete process.env.ALLOWED_ORGS;
    _clearOrgCache();
  });

  afterAll(() => {
    if (savedAllowedOrgs === undefined) {
      delete process.env.ALLOWED_ORGS;
    } else {
      process.env.ALLOWED_ORGS = savedAllowedOrgs;
    }
    _clearOrgCache();
  });

  it('returns null for valid input', () => {
    expect(validateScheduleBody(valid)).toBeNull();
  });

  it('rejects missing org', () => {
    expect(validateScheduleBody({ ...valid, org: '' })).toBe('org is required');
  });

  it('rejects non-string org', () => {
    expect(validateScheduleBody({ ...valid, org: 123 })).toBe('org is required');
  });

  it('rejects invalid periodDays', () => {
    expect(validateScheduleBody({ ...valid, periodDays: 7 })).toBe('periodDays must be 3, 14, 30, or 90');
  });

  it('accepts all valid periodDays values', () => {
    for (const d of [3, 14, 30, 90]) {
      expect(validateScheduleBody({ ...valid, periodDays: d })).toBeNull();
    }
  });

  it('rejects missing cronExpr', () => {
    expect(validateScheduleBody({ ...valid, cronExpr: '' })).toBe('cronExpr is required');
  });

  it('rejects non-string cronExpr', () => {
    expect(validateScheduleBody({ ...valid, cronExpr: 42 })).toBe('cronExpr is required');
  });

  it('rejects invalid cron expression', () => {
    expect(validateScheduleBody({ ...valid, cronExpr: 'not-a-cron' })).toBe('Invalid cron expression or timezone');
  });

  it('rejects missing timezone', () => {
    expect(validateScheduleBody({ ...valid, timezone: '' })).toBe('timezone is required');
  });

  it('rejects non-string timezone', () => {
    expect(validateScheduleBody({ ...valid, timezone: null })).toBe('timezone is required');
  });

  it('rejects invalid cron with valid timezone', () => {
    expect(validateScheduleBody({ ...valid, cronExpr: '99 99 99 99 99' })).toBe('Invalid cron expression or timezone');
  });

  describe('ALLOWED_ORGS enforcement (security mitigation)', () => {
    it('rejects org not in ALLOWED_ORGS allowlist', () => {
      process.env.ALLOWED_ORGS = 'allowed-org,another-allowed';
      _clearOrgCache();
      
      const result = validateScheduleBody({ ...valid, org: 'victim-org' });
      expect(result).toBe('Unknown or disallowed org');
    });

    it('accepts org in ALLOWED_ORGS allowlist', () => {
      process.env.ALLOWED_ORGS = 'allowed-org,my-org';
      _clearOrgCache();
      
      const result = validateScheduleBody({ ...valid, org: 'my-org' });
      expect(result).toBeNull();
    });

    it('performs case-insensitive org matching', () => {
      process.env.ALLOWED_ORGS = 'MyOrg';
      _clearOrgCache();
      
      expect(validateScheduleBody({ ...valid, org: 'myorg' })).toBeNull();
      expect(validateScheduleBody({ ...valid, org: 'MYORG' })).toBeNull();
      expect(validateScheduleBody({ ...valid, org: 'MyOrg' })).toBeNull();
    });

    it('prevents bypass via path traversal patterns', () => {
      process.env.ALLOWED_ORGS = 'safe-org';
      _clearOrgCache();
      
      const maliciousOrgs = [
        '../../victim-org',
        'victim/org',
        'victim;DROP',
        "victim'--",
        'victim org',
      ];
      
      for (const org of maliciousOrgs) {
        const result = validateScheduleBody({ ...valid, org });
        expect(result).toBe('Unknown or disallowed org');
      }
    });

    it('applies org validation to report schedules', () => {
      process.env.ALLOWED_ORGS = 'allowed-org';
      _clearOrgCache();
      
      // Report schedule (default kind)
      const reportSchedule = { ...valid, org: 'disallowed-org' };
      expect(validateScheduleBody(reportSchedule, 'report')).toBe('Unknown or disallowed org');
    });

    it('skips org validation for vuln_sync schedules', () => {
      process.env.ALLOWED_ORGS = 'allowed-org';
      _clearOrgCache();
      
      // vuln_sync schedules don't have org field, so validation should pass
      const vulnSyncSchedule = {
        cronExpr: '0 9 * * 1',
        timezone: 'America/New_York',
      };
      expect(validateScheduleBody(vulnSyncSchedule, 'vuln_sync')).toBeNull();
    });

    it('prevents administrator from scheduling reports for arbitrary orgs', () => {
      // Simulate the pentest scenario: admin tries to create schedule for org outside allowlist
      process.env.ALLOWED_ORGS = 'company-org';
      _clearOrgCache();
      
      const attackerSchedule = {
        org: 'target-victim-org',
        periodDays: 14,
        cronExpr: '0 9 * * 1',
        timezone: 'America/New_York',
      };
      
      const result = validateScheduleBody(attackerSchedule);
      expect(result).toBe('Unknown or disallowed org');
    });

    it('prevents update of existing schedule to disallowed org', () => {
      // Simulate the pentest scenario: admin tries to retarget existing schedule
      process.env.ALLOWED_ORGS = 'company-org';
      _clearOrgCache();
      
      const updateToDisallowedOrg = {
        org: 'another-victim-org',
        periodDays: 30,
        cronExpr: '0 10 * * 2',
        timezone: 'UTC',
      };
      
      const result = validateScheduleBody(updateToDisallowedOrg, 'report');
      expect(result).toBe('Unknown or disallowed org');
    });
  });
});
