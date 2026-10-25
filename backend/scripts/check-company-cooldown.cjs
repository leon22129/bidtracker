// Run after building: node scripts/check-company-cooldown.cjs
// All fixtures live in a new, randomly named PostgreSQL schema, which is removed afterward.
require('dotenv').config();
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { ApplicationsService } = require('../dist/applications/applications.service');
const { DuplicateService } = require('../dist/applications/duplicate.service');
const { BannedUrlService } = require('../dist/applications/banned-url.service');
const { NumberingService } = require('../dist/applications/numbering.service');
const { WorkspaceAccessService } = require('../dist/workspaces/workspace-access.service');
const { ImportService } = require('../dist/import/import.service');

const schema = `company_cooldown_test_${randomUUID().replaceAll('-', '')}`;
const root = new PrismaClient();
const address = new URL(process.env.DATABASE_URL);
address.searchParams.set('schema', schema);
address.searchParams.set('connection_limit', '1');
const clients = [0, 1].map(() => new PrismaClient({ datasources: { db: { url: address.toString() } } }));
const delay = () => new Promise((resolve) => setTimeout(resolve, 30));
let createdSchema = false;

function services(db) {
  const access = new WorkspaceAccessService(db);
  const numbering = new NumberingService(db);
  const duplicates = new DuplicateService(db);
  // Deliberately widen the check/write gap: without the lock both requests see no prior row.
  for (const method of ['findRecentCompanyMatch', 'classifyCompanyIdentities']) {
    const original = duplicates[method].bind(duplicates);
    duplicates[method] = async (...args) => {
      const result = await original(...args);
      await delay();
      return result;
    };
  }
  const banned = new BannedUrlService(db);
  const applications = new ApplicationsService(db, access, numbering, duplicates, banned, {
    notifyApplicationCreated: async () => {},
  });
  return { applications, imports: new ImportService(db, access, applications, duplicates, numbering, banned) };
}

async function main() {
  const diff = spawnSync(process.execPath, [
    require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-empty',
    '--to-schema-datamodel', 'prisma/schema.prisma', '--script',
  ], { encoding: 'utf8' });
  if (diff.status !== 0) throw new Error('Could not generate the isolated test schema');
  assert.match(schema, /^company_cooldown_test_[a-f0-9]{32}$/);
  await root.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  createdSchema = true;
  for (const statement of diff.stdout.split(';').map((sql) => sql.trim()).filter(Boolean)) {
    await clients[0].$executeRawUnsafe(statement);
  }
  const user = await clients[0].user.create({ data: {
    username: 'test-bidder', email: 'bidder@example.test', password_hash: 'unused-test-fixture', role: 'bidder',
  } });
  const [a, b] = clients.map(services);
  let workspaceNumber = 0;
  const workspace = () => clients[0].workspace.create({ data: {
    name: `test-${++workspaceNumber}`, owner_user_id: user.id,
  } });
  const input = (w, index, company_name = 'Acme') => ({
    workspace_id: w.id, company_name, job_title: `Different role ${index}`,
    url: `https://example.test/${w.id}/jobs/${index}`,
  });
  const file = (w) => ({
    originalname: 'applications.csv', mimetype: 'text/csv',
    buffer: Buffer.from([
      'URL,Company Name,Job Title',
      `https://example.test/${w.id}/import/1,Acme,Engineer`,
      `https://example.test/${w.id}/import/2,ACME Inc.,Designer`,
    ].join('\n')),
  });
  const count = (w) => clients[0].jobApplication.count({ where: { workspace_id: w.id } });
  const applied = (w, n) => clients[0].jobApplication.create({ data: {
    ...input(w, n), normalized_url: `example.test/${w.id}/jobs/${n}`,
    date: new Date(), number: n, created_by_user_id: user.id, application_status: 'Applied',
  } });

  const generated = await workspace();
  const generatedResults = await Promise.all([
    a.applications.createGenerated(user, input(generated, 1)),
    b.applications.createGenerated(user, input(generated, 2, 'ACME, Inc.')),
  ]);
  assert.equal(generatedResults.filter((result) => result.success).length, 1);
  assert.equal(generatedResults.filter((result) => result.duplicate).length, 1);
  assert.equal(await count(generated), 1);

  const manual = await workspace();
  const manualResults = await Promise.allSettled([
    a.applications.createManual(user, { ...input(manual, 1), application_status: 'Applied' }),
    b.applications.createManual(user, { ...input(manual, 2), application_status: 'Applied' }),
  ]);
  assert.equal(manualResults.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(manualResults.filter((result) => result.status === 'rejected' && result.reason.getStatus() === 409).length, 1);
  assert.equal(await count(manual), 1);

  const imports = await workspace();
  const importResults = await Promise.all([
    a.imports.import(user, imports.id, file(imports)), b.imports.import(user, imports.id, file(imports)),
  ]);
  assert.equal(importResults.reduce((sum, result) => sum + result.created, 0), 1);
  assert.equal(importResults.reduce((sum, result) => sum + result.skipped.length, 0), 3);
  assert.equal(await count(imports), 1);

  const mixed = await workspace();
  await Promise.all([
    a.applications.createGenerated(user, input(mixed, 1)), b.imports.import(user, mixed.id, file(mixed)),
  ]);
  assert.equal(await count(mixed), 1);

  const expiry = await workspace();
  const old = await applied(expiry, 1);
  const days = new DuplicateService(clients[0]).companyCooldownDays();
  await clients[0].jobApplication.update({ where: { id: old.id }, data: {
    date: new Date(Date.now() - (days + 1) * 86400000),
  } });
  assert.equal((await a.applications.createGenerated(user, input(expiry, 2))).success, true);
  assert.equal(await count(expiry), 2);

  for (const status of ['Applied', 'Rejected', 'Banned', 'Duplicated']) {
    const w = await workspace();
    const row = await applied(w, 1);
    await clients[0].jobApplication.update({ where: { id: row.id }, data: { application_status: status } });
    assert.equal((await a.applications.createGenerated(user, input(w, 2))).duplicate, true);
    assert.equal(await count(w), 1);
  }

  const edit = await workspace();
  const prior = await applied(edit, 1);
  await clients[0].jobApplication.update({ where: { id: prior.id }, data: { company_name: 'Other employer' } });
  await Promise.allSettled([
    a.applications.update(user, prior.id, { company_name: 'Acme' }),
    b.applications.createGenerated(user, input(edit, 2)),
  ]);
  assert.equal(await clients[0].jobApplication.count({ where: { workspace_id: edit.id, company_name: 'Acme' } }), 1);
  assert.equal(await clients[0].jobApplication.count({ where: { application_status: 'Duplicated', workspace_id: {
    in: [generated.id, manual.id, imports.id, mixed.id, expiry.id, edit.id],
  } } }), 0);
  console.log('PASS: concurrent saves, manual entries, imports, mixed requests, edits, cooldown expiry, and status-independent blocking');
}

main().catch((error) => {
  console.error(error.code || error.message);
  process.exitCode = 1;
}).finally(async () => {
  await Promise.all(clients.map((client) => client.$disconnect()));
  if (createdSchema && /^company_cooldown_test_[a-f0-9]{32}$/.test(schema)) {
    await root.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  }
  await root.$disconnect();
});
