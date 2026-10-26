// Build first. All records and migration checks live in an isolated PostgreSQL schema.
require('dotenv').config();
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { ApplicationsService } = require('../dist/applications/applications.service');
const { ApplicationDraftService } = require('../dist/applications/application-draft.service');
const { ApplicationGenerationService } = require('../dist/resume/resume.service');
const { DuplicateService } = require('../dist/applications/duplicate.service');
const { BannedUrlService } = require('../dist/applications/banned-url.service');
const { NumberingService } = require('../dist/applications/numbering.service');
const { WorkspaceAccessService } = require('../dist/workspaces/workspace-access.service');
const { PaymentsService } = require('../dist/payments/payments.service');

const schema = `application_workflow_test_${randomUUID().replaceAll('-', '')}`;
const root = new PrismaClient();
const address = new URL(process.env.DATABASE_URL);
address.searchParams.set('schema', schema);
const db = new PrismaClient({ datasources: { db: { url: address.toString() } } });
let createdSchema = false;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const file = { buffer: png, mimetype: 'image/png' };

async function runSql(sql) {
  for (const statement of sql.split(';').map((value) => value.trim()).filter(Boolean)) await db.$executeRawUnsafe(statement);
}

async function main() {
  const diff = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'diff',
    '--from-empty', '--to-schema-datamodel', 'prisma/schema.prisma', '--script'], { encoding: 'utf8' });
  if (diff.status !== 0) throw Error('Could not generate the isolated schema');
  assert.match(schema, /^application_workflow_test_[a-f0-9]{32}$/);
  await root.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  createdSchema = true;
  // Create the old tables, then exercise the actual draft migration against that existing schema.
  await runSql(diff.stdout.split(';').filter((statement) => !statement.includes('"application_drafts"')).join(';'));
  await runSql(readFileSync(join(__dirname, '../prisma/migrations/20261026000000_add_application_drafts/migration.sql'), 'utf8'));
  const user = await db.user.create({ data: { username: 'workflow-bidder', email: 'workflow@example.test', password_hash: 'fixture', role: 'bidder' } });
  const other = await db.user.create({ data: { username: 'other-bidder', email: 'other@example.test', password_hash: 'fixture', role: 'bidder' } });
  const workspace = await db.workspace.create({ data: { name: 'Workflow', owner_user_id: user.id } });
  const profile = await db.resumeProfile.create({ data: { workspace_id: workspace.id, name: 'Candidate', full_name: 'Candidate' } });
  const access = new WorkspaceAccessService(db);
  const duplicates = new DuplicateService(db);
  const banned = new BannedUrlService(db);
  const numbering = new NumberingService(db);
  const applications = new ApplicationsService(db, access, numbering, duplicates, banned, { notifyApplicationCreated: async () => {} });
  const drafts = new ApplicationDraftService(db, access, applications, duplicates, banned, numbering);
  const generation = new ApplicationGenerationService(db, access, duplicates, banned, applications, {}, drafts);
  const payments = new PaymentsService(db, access);
  const calls = [];
  generation.openAi = async (prompt, options) => {
    calls.push(options.operation);
    if (options.operation === 'job_identity') return JSON.stringify({ company_name: 'Unstructured', job_title: 'Engineer' });
    if (options.operation === 'job_eligibility') return JSON.stringify({
      company_name: prompt.match(/^Company:\s*(.+)$/m)?.[1] || 'Unstructured', job_title: 'Engineer',
      location: 'USA', workplace: 'Remote', department: '', employment_type: 'Full-time', salary: '',
      requires_clearance: prompt.includes('requires security clearance'), requires_public_trust: false,
      is_us_job: true, work_arrangement_is_remote_only: true, requires_in_person_interview: false, requires_onsite_onboarding: false,
    });
    if (options.operation === 'resume_generation') return JSON.stringify({
      summary: 'Prepared resume', skills: ['TypeScript'], workexperience: [],
      annual_salary: '$150,000', hourly_rate: '$72.12', rate_in_jd: false,
    });
    if (options.operation === 'application_answers') return JSON.stringify({ answers: [{ question: 'Why this role?', answer: 'It fits my experience.' }] });
    throw Error(`Unexpected AI operation ${options.operation}`);
  };
  generation.createAnswerConversation = async () => db.resumeConversation.create({ data: {
    openai_conversation_id: `fixture_${randomUUID()}`, user_id: user.id, workspace_id: workspace.id, profile_id: profile.id,
  } });
  let job = 0;
  const input = (company = 'Acme', description = 'Remote US engineering role. Responsibilities: • Build cloud services • Review changes. Qualifications: 5+ years with TypeScript.') => ({
    workspace_id: workspace.id, profile_id: profile.id, url: `https://jobs.example.test/${++job}`,
    job_description: `Job Information\nCompany: ${company}\nTitle: Engineer\n\nJob Description\n${description}`,
  });
  const count = () => db.jobApplication.count();
  const day = new Date().toISOString().slice(0, 10);
  const pay = async () => (await payments.report(user, { start_date: day, end_date: day })).total_applied;

  const source = input();
  const prepared = await generation.generate(user, source);
  assert.equal(prepared.success, true);
  assert.equal(prepared.application, undefined);
  assert.equal(await count(), 0);
  assert.equal(await pay(), 0);
  assert.deepEqual(calls, ['job_eligibility', 'resume_generation']);
  assert.match(prepared.job_description, /Expected Rate \(estimated\).*Annual: \$150,000/s);
  const saved = await drafts.latest(user, workspace.id);
  assert.equal(saved.source_job_description, source.job_description);
  assert.equal(saved.url, source.url);
  assert.equal(saved.resume.summary, 'Prepared resume');
  await generation.answerQuestions(user, { conversation_id: prepared.conversation_id, questions: [{ question: 'Why this role?' }] });
  assert.equal((await drafts.latest(user, workspace.id)).answers[0].answer, 'It fits my experience.');
  assert.equal(await count(), 0);
  await assert.rejects(drafts.submit(user, prepared.draft.id, undefined, true), /valid PNG/);
  await assert.rejects(drafts.submit(user, prepared.draft.id, { buffer: png.subarray(0, 8) }, true), /valid PNG/);
  await assert.rejects(drafts.submit(user, prepared.draft.id, file, false), /Confirm successful/);
  await assert.rejects(drafts.submit(other, prepared.draft.id, file, true), (error) => error.getStatus() === 404);

  const failingApplications = { withWorkspaceWrite: (id, action) => applications.withWorkspaceWrite(id, (context) => action({
    ...context, db: new Proxy(context.db, { get(target, name) {
      if (name === 'applicationScreenshot') return { create: async () => { throw Error('simulated screenshot failure'); } };
      return Reflect.get(target, name);
    } }),
  })) };
  const failingDrafts = new ApplicationDraftService(db, access, failingApplications, duplicates, banned, numbering);
  await assert.rejects(failingDrafts.submit(user, prepared.draft.id, file, true), /simulated screenshot failure/);
  assert.equal(await count(), 0);
  assert.equal((await drafts.latest(user, workspace.id)).submitted_at, null);
  const submitted = await Promise.all([drafts.submit(user, prepared.draft.id, file, true), drafts.submit(user, prepared.draft.id, file, true)]);
  assert.equal(submitted.filter((result) => result.already_added).length, 1);
  assert.equal(submitted[0].application.id, submitted[1].application.id);
  assert.equal(await count(), 1);
  assert.equal(await db.applicationScreenshot.count(), 1);
  assert.equal(await pay(), 1);
  const recorded = await db.jobApplication.findFirst();
  assert.equal(recorded.application_status, 'Applied');
  assert.match(recorded.job_description, /Responsibilities:\n\n- Build cloud services\n- Review changes\./);
  assert.match(recorded.job_description, /Qualifications:\n\n5\+ years with TypeScript\./);
  assert.deepEqual(JSON.parse(recorded.application_answers_json), [{ question: 'Why this role?', answer: 'It fits my experience.' }]);

  calls.length = 0;
  assert.equal((await generation.generate(user, input('Acme'))).duplicate, true);
  assert.deepEqual(calls, []);
  assert.equal(await count(), 1);
  assert.equal((await generation.generate(user, input('RejectedCo', 'This role requires security clearance.'))).eligible, false);
  assert.equal(await count(), 1);
  await banned.create('Banned Company', user.id);
  calls.length = 0;
  assert.equal((await generation.generate(user, input('Banned Company'))).banned, true);
  assert.deepEqual(calls, []);
  const stale = await generation.generate(user, input('New Ban'));
  await banned.create('New Ban', user.id);
  await assert.rejects(drafts.submit(user, stale.draft.id, file, true), /now banned/);
  assert.equal(await count(), 1);
  const concurrent = await Promise.all([generation.generate(user, input('ConcurrentCo')), generation.generate(user, input('ConcurrentCo'))]);
  const committed = await Promise.all(concurrent.map((value) => drafts.submit(user, value.draft.id, file, true)));
  assert.deepEqual(committed.map((value) => value.application.application_status).sort(), ['Applied', 'Duplicated']);
  assert.equal(await pay(), 2);
  assert.equal(await db.applicationScreenshot.count(), 3);
  const sameUrl = input('URLRaceCo');
  const urlDrafts = await Promise.all([generation.generate(user, sameUrl), generation.generate(user, sameUrl)]);
  await drafts.submit(user, urlDrafts[0].draft.id, file, true);
  await assert.rejects(drafts.submit(user, urlDrafts[1].draft.id, file, true), /already in the application table/);
  assert.equal(await db.applicationScreenshot.count(), 4);
  assert.equal(await count(), 4);
  console.log('PASS: draft migration, checks before eligibility, no early table/payment rows, persisted JD/resume/answers, atomic screenshot commit, failed-upload rollback, ownership, retries, final rechecks, and concurrent duplicate exclusion');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await db.$disconnect();
  if (createdSchema && /^application_workflow_test_[a-f0-9]{32}$/.test(schema)) await root.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await root.$disconnect();
});
