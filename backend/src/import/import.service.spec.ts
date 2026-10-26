import { assertSafeXlsxArchive, ImportService } from './import.service';
import ExcelJS from 'exceljs';

describe('ImportService missing company/title warnings', () => {
  const user = {
    id: 'user-1',
    email: 'user@example.com',
    username: 'user',
    role: 'bidder' as const,
  };
  const file = {
    originalname: 'applications.csv',
    mimetype: 'text/csv',
    buffer: Buffer.from([
      'URL,Company Name,Job Title',
      'https://example.com/jobs/1,Acme,Engineer',
      ',,',
      'https://example.com/jobs/2,,Designer',
      'https://example.com/jobs/3,,',
    ].join('\n')),
  };

  function setup() {
    const access = {
      assertCanEdit: jest.fn().mockResolvedValue(undefined),
      assertCanView: jest.fn().mockResolvedValue(undefined),
    };
    const applications = {
      withWorkspaceWrite: jest.fn(async (_workspaceId, action) => action({ db: {}, notifyUsers: new Set() })),
      insertChunked: jest.fn(async (rows: unknown[]) => rows.length),
    };
    const duplicates = {
      classifyBatch: jest.fn(async (_workspaceId, urls: string[]) =>
        urls.map((url) => ({ is_duplicate: false, normalized_url: url }))),
      classifyCompanyIdentities: jest.fn(async (_workspaceId, rows: unknown[]) =>
        rows.map(() => ({ is_duplicate: false }))),
      companyCooldownDays: jest.fn().mockReturnValue(90),
    };
    const numbering = { reserveBlock: jest.fn().mockResolvedValue(1) };
    const bannedUrls = { matchMany: jest.fn(async (urls: string[]) => urls.map(() => false)) };
    const service = new ImportService(
      {} as any,
      access as any,
      applications as any,
      duplicates as any,
      numbering as any,
      bannedUrls as any,
    );
    return { service, applications, bannedUrls, duplicates };
  }

  it('reports missing fields during preview', async () => {
    const { service } = setup();

    await expect(service.preview(user, 'workspace-1', file)).resolves.toMatchObject({
      missing_fields: [
        { row: 4, fields: ['company_name'] },
        { row: 5, fields: ['company_name', 'job_title'] },
      ],
    });
  });

  it('imports blank fields without a network lookup and returns rows that need review', async () => {
    const { service, applications } = setup();

    const result = await service.import(user, 'workspace-1', file);

    expect(result.missing_fields).toEqual([
      { row: 4, fields: ['company_name'] },
      { row: 5, fields: ['company_name', 'job_title'] },
    ]);
    expect(applications.insertChunked).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ url: 'https://example.com/jobs/2', company_name: null, job_title: 'Designer' }),
        expect.objectContaining({ url: 'https://example.com/jobs/3', company_name: null, job_title: null }),
      ]),
      'workspace-1',
      expect.anything(),
    );
  });

  it('imports an Excel workbook through the same validated path', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Applications');
    sheet.addRow(['URL', 'Company Name', 'Job Title', 'Status']);
    sheet.addRow(['https://example.com/jobs/10', 'Acme', 'Engineer', 'Applied']);
    sheet.addRow(['https://example.com/jobs/11', 'Globex', 'Designer', 'Pending']);
    const xlsx = {
      originalname: 'applications.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    };
    const { service } = setup();

    await expect(service.import(user, 'workspace-1', xlsx)).resolves.toMatchObject({
      total_rows: 2,
      created: 2,
      skipped: [],
      missing_fields: [],
    });
  });

  it('separates new banned URLs from genuine rejections', async () => {
    const { service, applications, bannedUrls, duplicates } = setup();
    const statusesFile = {
      ...file,
      buffer: Buffer.from([
        'URL,Company Name,Job Title,Status',
        'https://banned.example/jobs/1,Blocked,Engineer,Applied',
        'https://example.com/jobs/2,Acme,Engineer,Rejected',
      ].join('\n')),
    };
    bannedUrls.matchMany.mockResolvedValue([true, false]);
    duplicates.classifyBatch.mockResolvedValue([
      { is_duplicate: false, normalized_url: 'banned.example/jobs/1' },
      { is_duplicate: false, normalized_url: 'example.com/jobs/2' },
    ]);

    await service.import({ ...user, role: 'admin' }, 'workspace-1', statusesFile);

    expect(applications.insertChunked).toHaveBeenCalledWith([
      expect.objectContaining({
        application_status: 'Banned',
        note: 'this job is in banned list',
      }),
      expect.objectContaining({ application_status: 'Rejected', note: null }),
    ], 'workspace-1', expect.anything());
    expect(duplicates.classifyCompanyIdentities).toHaveBeenCalledWith('workspace-1', [
      { company_name: 'Blocked', job_title: 'Engineer' },
      { company_name: 'Acme', job_title: 'Engineer' },
    ], [], expect.anything());
  });

  it('skips reused URLs without letting their company names block valid rows', async () => {
    const { service, applications, duplicates, bannedUrls } = setup();
    const importFile = {
      ...file,
      buffer: Buffer.from([
        'URL,Company Name,Job Title',
        'https://example.com/jobs/existing,Acme,Engineer',
        'https://example.com/jobs/new,Acme,Designer',
      ].join('\n')),
    };
    duplicates.classifyBatch.mockResolvedValue([
      { is_duplicate: true, normalized_url: 'example.com/jobs/existing' },
      { is_duplicate: false, normalized_url: 'example.com/jobs/new' },
    ]);
    bannedUrls.matchMany.mockResolvedValue([true, false]);

    await expect(service.import(user, 'workspace-1', importFile)).resolves.toMatchObject({
      created: 1, duplicates: 1,
      skipped: [{ row: 2, reason: expect.stringContaining('URL already exists') }],
    });
    expect(duplicates.classifyCompanyIdentities).toHaveBeenCalledWith('workspace-1', [
      { company_name: 'Acme', job_title: 'Designer' },
    ], [], expect.anything());
    expect(applications.insertChunked).toHaveBeenCalledWith([
      expect.objectContaining({ url: 'https://example.com/jobs/new', application_status: 'Pending' }),
    ], 'workspace-1', expect.anything());
  });

  it('imports company matches as Duplicated while preserving their notes', async () => {
    const { service, applications, duplicates } = setup();
    const importFile = {
      ...file,
      buffer: Buffer.from('URL,Company Name,Job Title,Notes\nhttps://example.com/new,Omada Health,Engineer,Follow up'),
    };
    duplicates.classifyCompanyIdentities.mockResolvedValue([{ is_duplicate: true }]);

    await expect(service.import(user, 'workspace-1', importFile)).resolves.toMatchObject({
      created: 1, duplicates: 1, skipped: [],
    });
    expect(applications.insertChunked).toHaveBeenCalledWith([
      expect.objectContaining({ application_status: 'Duplicated', note: 'Follow up' }),
    ], 'workspace-1', expect.anything());
  });

  it('rejects an XLSX archive whose expanded contents exceed the configured bound', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Applications').addRow(['URL', 'https://example.com/jobs/1']);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await expect(assertSafeXlsxArchive(buffer, 1, 2000)).rejects.toThrow(
      'XLSX archive expands beyond',
    );
  });
});
