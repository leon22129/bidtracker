import { DuplicateService } from './duplicate.service';
import { BANNED_URL_NOTE } from '../common/utils/url.util';

// Preserve SQL's NULL behavior so NOT note filters cannot silently ignore ordinary applications.
function matchesNoteFilter(note: string | null, where: any): boolean | null {
  const results: Array<boolean | null> = [];
  if ('note' in where) {
    const filter = where.note;
    results.push(filter === null ? note === null : note === null ? null
      : typeof filter === 'string' ? note === filter : note.startsWith(filter.startsWith));
  }
  if (where.NOT) {
    for (const condition of Array.isArray(where.NOT) ? where.NOT : [where.NOT]) {
      const result = matchesNoteFilter(note, condition);
      results.push(result === null ? null : !result);
    }
  }
  if (where.OR) {
    const branches = where.OR.map((condition: any) => matchesNoteFilter(note, condition));
    results.push(branches.includes(true) ? true : branches.includes(null) ? null : false);
  }
  return results.includes(false) ? false : results.includes(null) ? null : true;
}

describe('DuplicateService URL and company detection', () => {
  it.each([14, 90, 400])('uses the configured %i-day window including the full boundary date', async (days) => {
    const prior = process.env.COMPANY_APPLICATION_COOLDOWN_DAYS;
    process.env.COMPANY_APPLICATION_COOLDOWN_DAYS = String(days);
    jest.useFakeTimers().setSystemTime(new Date('2026-10-25T19:30:00Z'));
    try {
      const boundary = new Date('2026-10-25T00:00:00Z');
      boundary.setUTCDate(boundary.getUTCDate() - days);
      const row = { id: 'boundary', workspace_id: 'workspace-1', company_name: 'Omada Health', date: boundary, note: null };
      const { service } = serviceWith([row]);
      expect(service.companyCooldownDays()).toBe(days);
      await expect(service.findRecentCompanyMatch('workspace-1', 'Omada Health')).resolves.toMatchObject({ id: 'boundary' });
      row.date = new Date(boundary.getTime() - 86400000);
      await expect(service.findRecentCompanyMatch('workspace-1', 'Omada Health')).resolves.toBeNull();
      row.date = boundary;
      await expect(service.findRecentCompanyMatch('other-workspace', 'Omada Health')).resolves.toBeNull();
    } finally {
      if (prior === undefined) delete process.env.COMPANY_APPLICATION_COOLDOWN_DAYS;
      else process.env.COMPANY_APPLICATION_COOLDOWN_DAYS = prior;
      jest.useRealTimers();
    }
  });

  function serviceWith(rows: any[] = []) {
    const prisma = {
      jobApplication: {
        findMany: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(
          rows.filter((row) => {
            if (where?.workspace_id && row.workspace_id !== where.workspace_id) return false;
            if (where?.normalized_url?.in && !where.normalized_url.in.includes(row.normalized_url)) return false;
            if (where?.date?.gte && row.date < where.date.gte) return false;
            if (where?.application_status?.not && row.application_status === where.application_status.not) return false;
            if (where?.application_status?.notIn?.includes(row.application_status)) return false;
            if (where?.id?.notIn?.includes(row.id)) return false;
            return matchesNoteFilter(row.note ?? null, where) === true;
          }),
        )),
      },
    };
    return { service: new DuplicateService(prisma as any), prisma };
  }

  it('classifies normalized variants of an existing URL as duplicates', async () => {
    const { service } = serviceWith([{
      id: 'app-1',
      url: 'https://www.example.com/jobs/123?utm_source=email',
      normalized_url: 'example.com/jobs/123',
      job_title: 'Engineer',
      company_name: 'Example',
      workspace_id: 'workspace-1',
      date: new Date('2026-09-22T00:00:00.000Z'),
      number: 1,
    }]);

    const [verdict] = await service.classifyBatch(
      'workspace-1',
      ['https://example.com/jobs/123'],
    );

    expect(verdict).toMatchObject({ is_duplicate: true, duplicate_type: 'url' });
    expect(verdict.existing).toMatchObject({ same_workspace: true, id: 'app-1' });
  });

  it('does not classify the same URL in another workspace as a duplicate', async () => {
    const { service, prisma } = serviceWith([{
      id: 'secret-app',
      url: 'https://example.com/jobs/123',
      normalized_url: 'example.com/jobs/123',
      job_title: 'Secret title',
      company_name: 'Secret company',
      workspace_id: 'secret-workspace',
      date: new Date('2026-09-22T00:00:00.000Z'),
      number: 42,
    }]);

    const [verdict] = await service.classifyBatch(
      'workspace-1',
      ['https://example.com/jobs/123'],
    );

    expect(verdict).toMatchObject({ is_duplicate: false });
    expect(verdict).not.toHaveProperty('existing');
    expect(prisma.jobApplication.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workspace_id: 'workspace-1' }),
    }));
  });

  it('detects repeated normalized URLs within one batch', async () => {
    const { service } = serviceWith();
    const verdicts = await service.classifyBatch('workspace-1', [
      'https://www.example.com/jobs/123',
      'https://example.com/jobs/123/',
    ]);

    expect(verdicts[0].is_duplicate).toBe(false);
    expect(verdicts[1]).toMatchObject({
      is_duplicate: true,
      reason: 'within_batch',
      duplicate_type: 'url',
    });
  });

  it('does not treat different URLs at the same company as duplicates', async () => {
    const { service } = serviceWith();
    const verdicts = await service.classifyBatch('workspace-1', [
      'https://example.com/jobs/123',
      'https://example.com/jobs/456',
    ]);

    expect(verdicts.every((verdict) => !verdict.is_duplicate)).toBe(true);
  });

  it('finds a recent workspace match by normalized company despite a different title', async () => {
    const row = {
      id: 'app-1',
      url: 'https://linkedin.com/jobs/view/123',
      normalized_url: 'linkedin.com/jobs/view/123',
      job_title: 'Software Engineer II',
      company_name: 'Acme, Inc.',
      workspace_id: 'workspace-1',
      date: new Date('2026-09-22T00:00:00.000Z'),
      number: 1,
    };
    const { service, prisma } = serviceWith([row]);

    await expect(service.findRecentCompanyMatch(
      'workspace-1',
      'Acme',
    )).resolves.toMatchObject({ id: 'app-1' });
    expect(prisma.jobApplication.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        workspace_id: 'workspace-1',
        date: { gte: expect.any(Date) },
      }),
    }));
  });

  it('does not match an application outside the 90-day company cooldown', async () => {
    const { service } = serviceWith([{
      id: 'old-app',
      url: 'https://example.com/jobs/old',
      normalized_url: 'example.com/jobs/old',
      job_title: 'Engineer',
      company_name: 'Visa Inc.',
      workspace_id: 'workspace-1',
      date: new Date('2020-01-01T00:00:00.000Z'),
      number: 1,
    }]);

    await expect(service.findRecentCompanyMatch('workspace-1', 'Visa')).resolves.toBeNull();
  });

  it('prevents another visible company row when historical duplicates exist', async () => {
    const { service } = serviceWith([{
      id: 'duplicate-attempt',
      url: 'https://example.com/jobs/duplicate',
      normalized_url: 'example.com/jobs/duplicate',
      job_title: 'Engineer',
      company_name: 'Visa',
      workspace_id: 'workspace-1',
      application_status: 'Duplicated',
      date: new Date(),
      number: 1,
    }]);

    await expect(service.findRecentCompanyMatch('workspace-1', 'Visa')).resolves.toMatchObject({ id: 'duplicate-attempt' });
  });

  it('classifies repeated normalized companies within one batch even when titles differ', async () => {
    const { service } = serviceWith();

    const verdicts = await service.classifyCompanyIdentities('workspace-1', [
      { company_name: 'Visa, Inc.' },
      { company_name: 'Visa' },
    ]);

    expect(verdicts[0].is_duplicate).toBe(false);
    expect(verdicts[1]).toMatchObject({ is_duplicate: true, reason: 'within_batch' });
  });

  it.each([null, '', 'Follow up next week'])(
    'counts prior applications with note %j for individual and batch company checks', async (note) => {
      const { service } = serviceWith([{
        id: 'prior-application', workspace_id: 'workspace-1', company_name: 'Acme, Inc.',
        job_title: 'Designer', date: new Date(), number: 1, application_status: 'Applied', note,
      }]);

      await expect(service.findRecentCompanyMatch('workspace-1', 'ACME'))
        .resolves.toMatchObject({ id: 'prior-application', job_title: 'Designer' });
      await expect(service.classifyCompanyIdentities('workspace-1', [{ company_name: 'Acme' }]))
        .resolves.toMatchObject([{ is_duplicate: true, reason: 'existing', existing: { id: 'prior-application' } }]);
    },
  );

  it.each([
    ['Applied', BANNED_URL_NOTE],
    ['Rejected', 'job eligibility check failed - it requires clearance'],
    ['Banned', null],
    ['Banned', 'Updated note'],
    ['Duplicated', null],
  ])('prevents additional company rows regardless of status %s or note %j', async (application_status, note) => {
    const { service } = serviceWith([{
      id: 'skipped', workspace_id: 'workspace-1', company_name: 'Acme',
      date: new Date(), application_status, note,
    }]);

    await expect(service.findRecentCompanyMatch('workspace-1', 'Acme')).resolves.toMatchObject({ id: 'skipped' });
    await expect(service.classifyCompanyIdentities('workspace-1', [{ company_name: 'Acme' }]))
      .resolves.toMatchObject([{ is_duplicate: true }]);
  });

  it('excludes the edited rows without losing other company matches', async () => {
    const rows = ['edited', 'other'].map((id) => ({
      id, workspace_id: 'workspace-1', company_name: 'Acme', job_title: id,
      date: new Date(), note: null, application_status: 'Applied',
    }));
    const { service } = serviceWith(rows);

    await expect(service.findRecentCompanyMatch('workspace-1', 'Acme', 'edited'))
      .resolves.toMatchObject({ id: 'other' });
    await expect(service.classifyCompanyIdentities('workspace-1', [{ company_name: 'Acme' }], ['edited']))
      .resolves.toMatchObject([{ is_duplicate: true, existing: { id: 'other' } }]);
    await expect(service.classifyCompanyIdentities('workspace-1', [{ company_name: 'Acme' }], ['edited', 'other']))
      .resolves.toMatchObject([{ is_duplicate: false }]);
  });
});
