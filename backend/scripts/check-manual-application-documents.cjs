// Build first. Test the real HTTP upload/download flow in an isolated PostgreSQL schema.
require('dotenv').config();
require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const build = join(__dirname, '..', process.env.MANUAL_DOCUMENTS_CHECK_BUILD || 'dist');
const { ApplicationsController } = require(join(build, 'applications/applications.controller'));
const { ApplicationsService } = require(join(build, 'applications/applications.service'));
const { ApplicationGenerationService } = require(join(build, 'resume/resume.service'));
const { ApplicationScreenshotService } = require(join(build, 'applications/application-screenshot.service'));
const { ApplicationDraftService } = require(join(build, 'applications/application-draft.service'));
const { DuplicateService } = require(join(build, 'applications/duplicate.service'));
const { BannedUrlService } = require(join(build, 'applications/banned-url.service'));
const { NumberingService } = require(join(build, 'applications/numbering.service'));
const { WorkspaceAccessService } = require(join(build, 'workspaces/workspace-access.service'));

const schema = `manual_documents_test_${randomUUID().replaceAll('-', '')}`;
const root = new PrismaClient();
const address = new URL(process.env.DATABASE_URL);
address.searchParams.set('schema', schema);
const db = new PrismaClient({ datasources: { db: { url: address.toString() } } });
let createdSchema = false;
let app;

async function runSql(sql) {
  for (const statement of sql.split(';').map((value) => value.trim()).filter(Boolean)) await db.$executeRawUnsafe(statement);
}

// A complete, small PDF fixture with an empty page.
function makePdf() {
  let value = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, body] of [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
  ].entries()) {
    offsets.push(Buffer.byteLength(value));
    value += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const start = Buffer.byteLength(value);
  value += 'xref\n0 4\n0000000000 65535 f \n';
  value += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  value += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(value);
}

async function main() {
  const diff = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'diff',
    '--from-empty', '--to-schema-datamodel', 'prisma/schema.prisma', '--script'], { encoding: 'utf8', windowsHide: true });
  assert.equal(diff.status, 0, diff.stderr);
  assert.match(schema, /^manual_documents_test_[a-f0-9]{32}$/);
  await root.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  createdSchema = true;
  await runSql(diff.stdout.split(';').filter((statement) => !statement.includes('"application_documents"')).join(';'));
  await runSql(readFileSync(join(__dirname, '../prisma/migrations/20261117000000_add_manual_application_documents/migration.sql'), 'utf8'));
  const user = await db.user.create({ data: { username: 'documents-bidder', email: 'documents@example.test', password_hash: 'fixture', role: 'bidder' } });
  const other = await db.user.create({ data: { username: 'other-documents-bidder', email: 'other-documents@example.test', password_hash: 'fixture', role: 'bidder' } });
  const workspace = await db.workspace.create({ data: { name: 'Manual documents', owner_user_id: user.id } });
  const access = new WorkspaceAccessService(db);
  const banned = new BannedUrlService(db);
  const applications = new ApplicationsService(db, access, new NumberingService(db), new DuplicateService(db), banned,
    { notifyApplicationCreated: async () => {} });
  const module = await Test.createTestingModule({
    controllers: [ApplicationsController],
    providers: [
      { provide: ApplicationsService, useValue: applications },
      { provide: BannedUrlService, useValue: banned },
      { provide: ApplicationGenerationService, useValue: {} },
      { provide: ApplicationScreenshotService, useValue: {} },
      { provide: ApplicationDraftService, useValue: {} },
    ],
  }).compile();
  app = module.createNestApplication({ logger: false });
  app.use((req, _res, next) => { req.user = req.headers['x-test-user'] === 'other' ? other : user; next(); });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const pdf = makePdf();
  let sequence = 0;
  function form(fields = {}, files = {}) {
    const data = new FormData();
    sequence++;
    for (const [key, value] of Object.entries({
      workspace_id: workspace.id, job_title: 'Engineer', company_name: `Company ${sequence}`,
      url: `https://example.test/jobs/${sequence}`, application_status: 'Applied', ...fields,
    })) data.append(key, value);
    for (const [key, bytes] of Object.entries(files)) data.append(key, new Blob([bytes], { type: 'application/pdf' }), `${key}.pdf`);
    return data;
  }
  async function post(body, status = 201) {
    const response = await fetch(`${base}/applications`, { method: 'POST', body });
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  }
  for (const fields of [{}, { resume_text: 'Resume' }, { job_description: 'Job' }, { resume_text: '  ', job_description: 'Job' }]) {
    await post(form(fields), 400);
  }
  await post(form({ resume_text: 'r'.repeat(50_001), job_description: 'Job' }), 400);
  await post(form({ job_description: 'Job' }, { resume_pdf: Buffer.from('not a PDF') }), 400);
  await post(form({ job_description: 'Job' }, { resume_pdf: Buffer.alloc(5 * 1024 * 1024 + 1) }), 413);
  assert.equal(await db.jobApplication.count(), 0, 'Invalid uploads must not create partial applications');
  console.log('PASS: missing, blank, oversized, and invalid documents are rejected without creating rows');

  const cases = [
    [{ resume_text: ' Résumé\nTypeScript ', job_description: ' Build software\nRemote ' }, {}],
    [{}, { resume_pdf: pdf, job_description_pdf: pdf }],
    [{ job_description: 'Job text' }, { resume_pdf: pdf }],
    [{ resume_text: 'Resume text' }, { job_description_pdf: pdf }],
    [{ resume_text: 'Resume text', job_description: 'Job text' }, { resume_pdf: pdf, job_description_pdf: pdf }],
  ];
  for (const [fields, files] of cases) {
    const body = form(fields, files);
    const row = await post(body);
    assert.equal(row.documents.length, Object.keys(fields).length + Object.keys(files).length);
    assert.equal(row.resume_generated_at, null, 'Manual attachments must not masquerade as generated resumes');
    for (const document of row.documents) {
      assert.deepEqual(Object.keys(document).sort(), ['filename', 'format', 'kind'], 'List metadata must omit binary data');
      const path = `${base}/applications/${row.id}/documents/${document.kind}/${document.format}`;
      const response = await fetch(path);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.match(response.headers.get('content-disposition'), /^attachment;/);
      const expected = document.format === 'pdf' ? pdf : Buffer.from(fields[document.kind === 'resume' ? 'resume_text' : 'job_description'].trim());
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected, 'Downloads preserve original PDF bytes and text content');
      assert.equal((await fetch(path, { headers: { 'x-test-user': 'other' } })).status, 404, 'Other bidders cannot access documents');
    }
    await post(form({ ...fields, url: row.url }, files), 409);
  }
  const listing = await fetch(`${base}/applications?workspace_id=${workspace.id}`).then((response) => response.json());
  assert.equal(listing.items.length, cases.length);
  assert.ok(listing.items.every((item) => item.documents.length >= 2));
  const first = listing.items[0];
  const beforeDelete = await db.applicationDocument.count();
  await db.jobApplication.delete({ where: { id: first.id } });
  assert.equal(await db.applicationDocument.count(), beforeDelete - first.documents.length, 'Application deletion cleans up its documents');
  console.log('PASS: text, PDFs, mixed formats, both versions, exact downloads, access control, duplicates, table metadata, and cascading deletion');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await app?.close();
  await db.$disconnect();
  if (createdSchema) {
    assert.match(schema, /^manual_documents_test_[a-f0-9]{32}$/);
    await root.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  }
  await root.$disconnect();
});
