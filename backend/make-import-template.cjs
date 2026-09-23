/**
 * Generates the import templates in docs/. Run from backend/:  node make-template.cjs
 *
 * Kept as a script rather than a checked-in binary blob so the template can never drift from
 * COLUMN_ALIASES in src/import/import.service.ts — the headers below are the canonical names.
 */
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'docs');
const HEADERS = ['Date', 'Job Title', 'Company Name', 'URL', 'Status', 'Note'];
const ROWS = [
  ['2026-08-24', 'Senior Backend Engineer', 'Acme Corp', 'https://boards.greenhouse.io/acme/jobs/1234567', 'Applied', 'Referred by a friend'],
  ['2026-08-24', '', '', 'https://jobs.lever.co/globex/8f3c1a2b-0000-4444-9999-abcdef123456', 'Applied', 'Title and company left blank on purpose - filled in automatically'],
  ['2026-08-25', 'Platform Engineer', 'Initech', 'https://initech.wd1.myworkdayjobs.com/careers/job/Platform-Engineer_R-9911', 'Pending', ''],
  ['2026-08-25', 'Site Reliability Engineer', 'Hooli', 'https://careers.hooli.com/job/sre-2026', 'Rejected', 'Auto-rejected same day'],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  // --- xlsx ---------------------------------------------------------------
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Applications');
  ws.addRow(HEADERS);
  ROWS.forEach((r) => ws.addRow(r));

  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF1F5' } };
  ws.columns = [
    { width: 12 }, { width: 28 }, { width: 20 }, { width: 62 }, { width: 12 }, { width: 42 },
  ];
  // Text format on the date column: an Excel date cell is read correctly either way, but plain
  // YYYY-MM-DD text is what people paste in, and it round-trips without locale surprises.
  ws.getColumn(1).numFmt = '@';
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // Guidance goes on a SECOND sheet, not below the data: the parser reads worksheets[0] and treats
  // every non-empty row as a record, so notes in the data sheet come back as "row 6: Missing URL".
  const help = wb.addWorksheet('Instructions');
  help.columns = [{ width: 110 }];
  [
    'Put your rows on the "Applications" sheet. Only the URL column is required.',
    '',
    'URL           required. Anything else can be blank.',
    'Date          YYYY-MM-DD, M/D/YYYY, or a real Excel date cell. Blank = the date you pick on the upload page.',
    'Job Title     blank is fine - it is read from the job posting when "Fetch company and job title" is on.',
    'Company Name  same. Company names are never used for duplicate detection, so duplicates are safe here.',
    'Status        Pending, Applied or Rejected. Blank = Pending. "Duplicated" is set by the system and is admin-only.',
    'Note          free text.',
    '',
    'Header names are matched loosely: "Job URL", "Link", "Company", "Notes" and similar variants all work.',
    'Column order does not matter. Extra columns are ignored.',
    '',
    'Only the FIRST sheet is read. This sheet is ignored.',
    'Do not add notes or totals below your data - every non-empty row is treated as a record.',
    'Maximum 20,000 rows and 25 MB per file.',
  ].forEach((line) => {
    const r = help.addRow([line]);
    if (/^[A-Z]/.test(line) && /^\S+\s{2,}/.test(line)) r.font = { name: 'Consolas', size: 10 };
  });
  help.getRow(1).font = { bold: true };

  await wb.xlsx.writeFile(path.join(OUT, 'import-template.xlsx'));

  // --- csv ----------------------------------------------------------------
  const esc = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = [HEADERS, ...ROWS].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
  fs.writeFileSync(path.join(OUT, 'import-template.csv'), '﻿' + csv, 'utf8');

  console.log('wrote docs/import-template.xlsx and docs/import-template.csv');
})();
