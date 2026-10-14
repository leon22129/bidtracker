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
    const applications = { insertChunked: jest.fn(async (rows: unknown[]) => rows.length) };
    const duplicates = {
      classifyBatch: jest.fn(async (_workspaceId, urls: string[]) =>
        urls.map((url) => ({ is_duplicate: false, normalized_url: url }))),
      classifyCompanyIdentities: jest.fn(async (_workspaceId, rows: unknown[]) =>
        rows.map(() => ({ is_duplicate: false }))),
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
    return { service, applications };
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

  it('rejects an XLSX archive whose expanded contents exceed the configured bound', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Applications').addRow(['URL', 'https://example.com/jobs/1']);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await expect(assertSafeXlsxArchive(buffer, 1, 2000)).rejects.toThrow(
      'XLSX archive expands beyond',
    );
  });
});
