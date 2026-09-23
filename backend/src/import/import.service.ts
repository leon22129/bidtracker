import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';
import { ApplicationsService } from '../applications/applications.service';
import { DuplicateService } from '../applications/duplicate.service';
import { NumberingService } from '../applications/numbering.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { APPLICATION_STATUSES, ApplicationStatus, MAX_ROWS_PER_INGEST } from '../common/constants';
import { assertStatusTransition } from '../common/policies/application.policy';
import { toDayStart, todayUtc } from '../common/utils/date.util';
import {
  BANNED_URL_NOTE,
  detectJobSource,
  looksLikeUrl,
  normalizeUrl,
} from '../common/utils/url.util';
import { createJobFingerprint } from '../common/utils/job-fingerprint.util';
import { BannedUrlService } from '../applications/banned-url.service';
import { ApplicationIngestionLockService } from '../applications/application-ingestion-lock.service';

/**
 * Column aliases. Real-world spreadsheets from bidders never use exactly the header you asked for, so
 * matching is case/space/punctuation-insensitive over a list of synonyms.
 */
const COLUMN_ALIASES: Record<string, string[]> = {
  date: ['date', 'applieddate', 'applicationdate', 'day', 'submitteddate'],
  job_title: ['jobtitle', 'title', 'position', 'role', 'jobname'],
  company_name: ['companyname', 'company', 'employer', 'organization', 'org'],
  url: ['url', 'joburl', 'link', 'joblink', 'applicationurl', 'joburllink', 'jobposting'],
  application_status: ['status', 'applicationstatus', 'appstatus'],
  note: ['note', 'notes', 'comment', 'comments', 'remark', 'remarks'],
};

export interface ImportResult {
  total_rows: number;
  created: number;
  duplicates: number;
  skipped: Array<{ row: number; reason: string }>;
  missing_fields: MissingFieldWarning[];
  detected_columns: Record<string, string | null>;
}

type MissingField = 'job_title' | 'company_name';
interface MissingFieldWarning {
  row: number;
  fields: MissingField[];
}

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly applications: ApplicationsService,
    private readonly duplicates: DuplicateService,
    private readonly numbering: NumberingService,
    private readonly bannedUrls: BannedUrlService,
    private readonly ingestionLock: ApplicationIngestionLockService,
  ) {}

  async import(
    user: AuthUser,
    workspaceId: string,
    file: { originalname: string; buffer: Buffer; mimetype: string },
    options: { defaultDate?: string } = {},
  ): Promise<ImportResult> {
    await this.access.assertCanEdit(user, workspaceId);

    if (!file?.buffer?.length) throw new BadRequestException('No file uploaded');

    const isCsv =
      /\.csv$/i.test(file.originalname) ||
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/csv';

    const raw = isCsv ? parseCsv(file.buffer) : await parseXlsx(file.buffer);
    if (raw.length < 2) {
      throw new BadRequestException('The file appears to be empty or has no data rows');
    }

    const header = raw[0].map((c) => String(c ?? ''));
    const map = mapColumns(header);
    if (map.url === null) {
      throw new BadRequestException(
        `Could not find a URL column. Detected headers: ${header.filter(Boolean).join(', ') || '(none)'}. ` +
          'Add a column named "URL".',
      );
    }

    const dataRows = raw
      .slice(1)
      .map((cells, index) => ({ cells, rowNumber: index + 2 }))
      .filter(({ cells }) => cells.some((cell) => String(cell ?? '').trim() !== ''));
    if (dataRows.length > MAX_ROWS_PER_INGEST) {
      throw new BadRequestException(
        `File has ${dataRows.length} rows; the maximum per import is ${MAX_ROWS_PER_INGEST}. Split the file.`,
      );
    }

    const fallbackDate = options.defaultDate ? toDayStart(options.defaultDate) : todayUtc();

    // --- Pass 1: parse + validate, no DB writes -----------------------------
    const skipped: Array<{ row: number; reason: string }> = [];
    const parsed: ParsedRow[] = [];

    dataRows.forEach(({ cells, rowNumber }) => {
      const get = (key: string) =>
        map[key] === null || map[key] === undefined ? '' : String(cells[map[key]!] ?? '').trim();

      const url = get('url');
      if (!url) {
        skipped.push({ row: rowNumber, reason: 'Missing URL' });
        return;
      }
      if (!looksLikeUrl(url)) {
        skipped.push({ row: rowNumber, reason: `"${truncate(url, 60)}" is not a valid URL` });
        return;
      }

      let date = fallbackDate;
      const rawDate = map.date !== null ? cells[map.date!] : null;
      if (rawDate !== null && rawDate !== undefined && String(rawDate).trim() !== '') {
        try {
          date = toDayStart(rawDate instanceof Date ? rawDate : String(rawDate).trim());
        } catch {
          skipped.push({ row: rowNumber, reason: `Unrecognised date "${String(rawDate)}"` });
          return;
        }
      }

      // Status from the file is untrusted input. Route it through the SAME state machine used by
      // inline editing, treating the import as a transition from `Pending`. Without this, a CSV with
      // Status=Duplicated would be a hole straight through the permission model.
      let status: ApplicationStatus = 'Pending';
      const rawStatus = get('application_status');
      if (rawStatus) {
        const matched = APPLICATION_STATUSES.find(
          (s) => s.toLowerCase() === rawStatus.toLowerCase(),
        );
        if (!matched) {
          skipped.push({
            row: rowNumber,
            reason: `Unknown status "${rawStatus}" (expected: ${APPLICATION_STATUSES.join(', ')})`,
          });
          return;
        }
        try {
          assertStatusTransition('Pending', matched, user.role);
          status = matched;
        } catch {
          skipped.push({
            row: rowNumber,
            reason: `Your role cannot import rows with status "${matched}"; imported as Pending instead`,
          });
          status = 'Pending';
        }
      }

      parsed.push({
        rowNumber,
        url,
        date,
        status,
        job_title: nullIfBlank(get('job_title')),
        company_name: nullIfBlank(get('company_name')),
        note: nullIfBlank(get('note')),
      });
    });

    if (parsed.length === 0) {
      return {
        total_rows: dataRows.length,
        created: 0,
        duplicates: 0,
        skipped,
        missing_fields: [],
        detected_columns: map as any,
      };
    }

    const missingFields = collectMissingFields(parsed);

    return this.ingestionLock.runExclusive(async () => {
      // --- Pass 2: duplicate classification (one batched query set) ---------
      const urlVerdicts = await this.duplicates.classifyBatch(
        workspaceId,
        parsed.map((p) => p.url),
      );

      // --- Pass 3: classify company/title identities exactly as supplied ------
      const bannedVerdicts = await this.bannedUrls.matchMany(parsed.map((row) => row.url));
      const identityVerdicts = await this.duplicates.classifyJobIdentities(
        workspaceId,
        parsed.map((row) => ({
          company_name: row.company_name,
          job_title: row.job_title,
        })),
      );
      const verdicts = urlVerdicts.map((verdict, index) => {
        const identity = identityVerdicts[index];
        return verdict.is_duplicate || !identity.is_duplicate
          ? verdict
          : {
              ...verdict,
              is_duplicate: true,
              reason: identity.reason,
              duplicate_type: 'job_fingerprint' as const,
              existing: identity.existing,
            };
      });
      const verdictByRow = new Map(parsed.map((row, index) => [row, verdicts[index]]));
      const bannedByRow = new Map(parsed.map((row, index) => [row, bannedVerdicts[index]]));

      // --- Pass 4: allocate numbers per date, then batch insert ---------------
      const byDate = new Map<number, ParsedRow[]>();
      for (const row of parsed) {
        const key = row.date.getTime();
        if (!byDate.has(key)) byDate.set(key, []);
        byDate.get(key)!.push(row);
      }

      const inserts: any[] = [];
      for (const [time, rows] of byDate) {
        const date = new Date(time);
        const start = await this.numbering.reserveBlock(this.prisma, workspaceId, date, rows.length);
        rows.forEach((row, idx) => {
          const verdict = verdictByRow.get(row);
          const banned = bannedByRow.get(row) ?? false;
          inserts.push({
            workspace_id: workspaceId,
            date,
            number: start + idx,
            url: row.url,
            normalized_url: verdict?.normalized_url ?? normalizeUrl(row.url),
            job_source: detectJobSource(row.url),
            // Banned URLs are auto-rejected, regardless of spreadsheet status or duplicate checks.
            application_status: banned ? 'Rejected' : verdict?.is_duplicate ? 'Duplicated' : row.status,
            pipeline_status: 'Not Started',
            job_title: row.job_title,
            company_name: row.company_name,
            job_fingerprint: createJobFingerprint(row.company_name, row.job_title),
            note: banned ? BANNED_URL_NOTE : row.note,
            created_by_user_id: user.id,
          });
        });
      }

      const created = await this.applications.insertChunked(inserts, workspaceId);

      this.logger.log(
        `Import into ${workspaceId} by ${user.username}: ${created} created, ` +
          `${verdicts.filter((v) => v.is_duplicate).length} duplicates, ${skipped.length} skipped`,
      );

      return {
        total_rows: dataRows.length,
        created,
        duplicates: verdicts.filter((v) => v.is_duplicate).length,
        skipped: skipped.slice(0, 200),
        missing_fields: missingFields,
        detected_columns: map as any,
      };
    });
  }

  /** Column-mapping dry run so the UI can show the user what it understood before committing. */
  async preview(user: AuthUser, workspaceId: string, file: { originalname: string; buffer: Buffer; mimetype: string }) {
    await this.access.assertCanView(user, workspaceId);

    const isCsv = /\.csv$/i.test(file.originalname);
    const raw = isCsv ? parseCsv(file.buffer) : await parseXlsx(file.buffer);
    if (!raw.length) throw new BadRequestException('The file appears to be empty');

    const header = raw[0].map((c) => String(c ?? ''));
    const map = mapColumns(header);
    const dataRows = raw
      .slice(1)
      .map((cells, index) => ({ cells, rowNumber: index + 2 }))
      .filter(({ cells }) => cells.some((cell) => String(cell ?? '').trim() !== ''));
    const parsedForWarnings: Array<Pick<ParsedRow, 'rowNumber' | 'job_title' | 'company_name'>> = [];
    dataRows.forEach(({ cells, rowNumber }) => {
      const get = (key: string) =>
        map[key] === null || map[key] === undefined ? '' : String(cells[map[key]!] ?? '').trim();
      if (!looksLikeUrl(get('url'))) return;
      parsedForWarnings.push({
        rowNumber,
        job_title: nullIfBlank(get('job_title')),
        company_name: nullIfBlank(get('company_name')),
      });
    });

    return {
      headers: header,
      detected_columns: map,
      total_rows: dataRows.length,
      sample: dataRows.slice(0, 5).map(({ cells }) => cells),
      missing_fields: collectMissingFields(parsedForWarnings),
    };
  }
}

interface ParsedRow {
  rowNumber: number;
  url: string;
  date: Date;
  status: ApplicationStatus;
  job_title: string | null;
  company_name: string | null;
  note: string | null;
}

function canon(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function mapColumns(header: string[]): Record<string, number | null> {
  const canonical = header.map(canon);
  const out: Record<string, number | null> = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = canonical.findIndex((h) => h && aliases.includes(h));
    out[field] = idx === -1 ? null : idx;
  }
  return out;
}

async function parseXlsx(buffer: Buffer): Promise<any[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new BadRequestException('The workbook has no sheets');

  const rows: any[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as any[]; // ExcelJS is 1-indexed; drop the leading hole
    const cells = values.slice(1).map((v) => {
      if (v === null || v === undefined) return '';
      if (v instanceof Date) return v;
      if (typeof v === 'object') {
        // Hyperlink cells: { text, hyperlink }. Rich text: { richText: [...] }. Formula: { result }.
        if ('hyperlink' in v && v.hyperlink) return String(v.hyperlink);
        if ('text' in v && v.text) return String(v.text);
        if ('result' in v) return String(v.result ?? '');
        if ('richText' in v && Array.isArray(v.richText)) {
          return v.richText.map((r: any) => r.text).join('');
        }
        return '';
      }
      return v;
    });
    rows.push(cells);
  });
  return rows;
}

/** RFC-4180-aware CSV parser: handles quoted fields, embedded commas/newlines and escaped quotes. */
export function parseCsv(buffer: Buffer): any[][] {
  let text = buffer.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM

  // Detect the delimiter from the header line — European exports often use ';'.
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function nullIfBlank(v: string): string | null {
  const t = v.trim();
  return t === '' ? null : t;
}

function collectMissingFields(
  rows: Array<Pick<ParsedRow, 'rowNumber' | 'job_title' | 'company_name'>>,
): MissingFieldWarning[] {
  return rows.flatMap((row) => {
    const fields: MissingField[] = [];
    if (!row.company_name) fields.push('company_name');
    if (!row.job_title) fields.push('job_title');
    return fields.length ? [{ row: row.rowNumber, fields }] : [];
  });
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
