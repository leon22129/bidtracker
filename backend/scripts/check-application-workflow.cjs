// Build first. All records and migration checks live in an isolated PostgreSQL schema.
require('dotenv').config();
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { PrismaClient } = require('@prisma/client');
const build = join(__dirname, '..', process.env.WORKFLOW_CHECK_BUILD || 'dist');
const { ApplicationsService } = require(join(build, 'applications/applications.service'));
const { ApplicationDraftService } = require(join(build, 'applications/application-draft.service'));
const { ApplicationGenerationService } = require(join(build, 'resume/resume.service'));
const { applicationQuestionId } = require(join(build, 'resume/original-prompts'));
const { GenerationJobsService } = require(join(build, 'resume/generation-jobs.service'));
const { DuplicateService } = require(join(build, 'applications/duplicate.service'));
const { BannedUrlService } = require(join(build, 'applications/banned-url.service'));
const { NumberingService } = require(join(build, 'applications/numbering.service'));
const { WorkspaceAccessService } = require(join(build, 'workspaces/workspace-access.service'));
const { PaymentsService } = require(join(build, 'payments/payments.service'));

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
  await runSql(diff.stdout.replace(/^\s*"(?:application_form_json|answer_cache_json)" TEXT,?\r?\n/gm, '').split(';').filter((statement) => !statement.includes('"application_drafts"') && !statement.includes('"generation_jobs"') && !statement.includes('"resume_generation_reservations"')).join(';'));
  await runSql(readFileSync(join(__dirname, '../prisma/migrations/20261026000000_add_application_drafts/migration.sql'), 'utf8'));
  await runSql(readFileSync(join(__dirname, '../prisma/migrations/20261103000000_add_application_form_capture/migration.sql'), 'utf8'));
  await runSql(readFileSync(join(__dirname, '../prisma/migrations/20261109000000_add_application_answer_cache/migration.sql'), 'utf8'));
  await runSql(readFileSync(join(__dirname, '../prisma/migrations/20261109010000_add_generation_jobs/migration.sql'), 'utf8'));
  await runSql(readFileSync(join(__dirname, '../prisma/migrations/20261118000000_add_resume_generation_reservations/migration.sql'), 'utf8'));
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
  const { DEFAULT_RESUME_PROMPT } = require(join(build, 'ai/resume-prompt'));
  // Provider calls are stubbed below; credential persistence has its own integration check.
  const aiSettings = { forWorkspace: async () => ({ provider: 'openai', model: 'gpt-6.1-sol',
    apiKey: 'workflow-fixture', baseUrl: 'https://api.openai.com/v1', resumePrompt: DEFAULT_RESUME_PROMPT }) };
  const generation = new ApplicationGenerationService(db, access, duplicates, banned, applications, {}, drafts, aiSettings);
  const payments = new PaymentsService(db, access);
  const calls = [];
  generation.generateText = async (prompt, options) => {
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
    if (options.operation === 'application_answers') return JSON.stringify({ answers: [{
      question_id: applicationQuestionId({ question: 'Why this role?' }), answer: 'It fits my experience.',
    }] });
    throw Error(`Unexpected AI operation ${options.operation}`);
  };
  generation.requestProvider = async (_path, _body, _method, operation) => {
    throw Error(`Unexpected provider operation ${operation}`);
  };
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
  assert.equal(await db.resumeGenerationReservation.count(), 0, 'Successful generation replaces the claim with a draft');
  calls.length = 0;
  assert.equal((await generation.generate(user, input('ACME, Inc.'))).duplicate_type, 'prepared');
  assert.equal((await generation.generate(user, { ...input('Different Employer'), url: source.url + '?utm_source=test' })).duplicate_type, 'prepared');
  assert.deepEqual(calls, [], 'Prepared companies and URLs are blocked before any provider call');
  assert.equal((await drafts.getPrepared(user, prepared.draft.id)).id, prepared.draft.id);
  await assert.rejects(drafts.getPrepared(other, prepared.draft.id), (error) => error.getStatus() === 404);
  await assert.rejects(drafts.discard(other, prepared.draft.id), (error) => error.getStatus() === 404);
  // Old clients could create overlapping drafts. Keep fixtures for the last submission safeguard.
  const legacyDraft = async (id, differentUrl = false) => {
    const { id: oldId, created_at, updated_at, ...data } = await db.applicationDraft.findUniqueOrThrow({ where: { id } });
    if (differentUrl) { data.url += '-legacy'; data.normalized_url += '-legacy'; }
    return { draft: await db.applicationDraft.create({ data: { ...data, conversation_id: null, submitted_at: null, submitted_application_id: null } }) };
  };
  const conversation = await db.resumeConversation.findUniqueOrThrow({ where: { id: prepared.conversation_id } });
  assert.match(conversation.openai_conversation_id, /^local_/);
  assert.match(conversation.reference_context, /"fullName":"Candidate"/);
  assert.match(prepared.job_description, /Expected Rate \(estimated\).*Annual: \$150,000/s);
  const saved = await drafts.latest(user, workspace.id);
  assert.equal(saved.source_job_description, source.job_description);
  assert.equal(saved.url, source.url);
  assert.equal(saved.resume.summary, 'Prepared resume');
  await generation.answerQuestions(user, { conversation_id: prepared.conversation_id, questions: [{ question: 'Why this role?' }] });
  assert.equal((await drafts.latest(user, workspace.id)).answers[0].answer, 'It fits my experience.');
  const cached = await db.resumeConversation.findUniqueOrThrow({ where: { id: prepared.conversation_id } });
  assert.ok(cached.answer_cache_json.includes('It fits my experience.'));
  const callsBeforeReuse = calls.length;
  await generation.answerQuestions(user, { conversation_id: prepared.conversation_id, questions: [{ question: 'Name' }, { question: 'Why this role?' }] });
  assert.equal(calls.length, callsBeforeReuse, 'profile fields and cached answers need no model request');

  const manual = await generation.generate(user, { ...input('Manual Company'), mode: 'manual', url: undefined });
  assert.equal(manual.success, true);
  assert.equal(manual.draft.url, '');
  assert.equal((await drafts.latest(user, workspace.id)).id, prepared.draft.id, 'Linked history excludes manual drafts');
  assert.equal((await drafts.latest(user, workspace.id, 'manual')).id, manual.draft.id);
  await generation.answerQuestions(user, { conversation_id: manual.conversation_id, questions: [{ question: 'Why this role?' }] });
  assert.equal((await drafts.latest(user, workspace.id, 'manual')).answers[0].answer, 'It fits my experience.');
  await assert.rejects(drafts.latest(other, workspace.id, 'manual'), (error) => error.getStatus() === 404);
  await assert.rejects(drafts.submit(user, manual.draft.id, undefined, true), /valid PNG/);
  await assert.rejects(drafts.submit(user, manual.draft.id, file, false), /Confirm successful/);
  for (const url of [undefined, 'javascript:alert(1)', 'not a URL']) {
    await assert.rejects(drafts.submit(user, manual.draft.id, file, true, url), /confirmation page/);
  }
  assert.equal(await count(), 0, 'Manual preparation does not add an application');
  assert.equal(await pay(), 0);
  const capturedStep = (key, answer, time) => ({ key, step: key, url: source.url, captured_at: time,
    fields: [{ id: 'why', question: 'Why this role?', answer, section: '', field_type: 'textarea' }] });
  const capturedAt = Date.now();
  await assert.rejects(drafts.saveFormStep(other, prepared.draft.id, capturedStep('Questions', 'Wrong bidder', capturedAt)), (error) => error.getStatus() === 404);
  await Promise.all([
    drafts.saveFormStep(user, prepared.draft.id, capturedStep('Questions', 'Actual bidder answer', capturedAt)),
    drafts.saveFormStep(user, prepared.draft.id, capturedStep('Experience', 'Actual experience', capturedAt)),
  ]);
  await drafts.saveFormStep(user, prepared.draft.id, capturedStep('Questions', 'Revised bidder answer', capturedAt + 1));
  await drafts.saveFormStep(user, prepared.draft.id, capturedStep('Questions', 'Stale retry', capturedAt));
  // Generating another suggestion must never change observed form entries.
  await generation.answerQuestions(user, { conversation_id: prepared.conversation_id, questions: [{ question: 'Why this role?' }] });
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
  const artifact = await applications.getResume(user, recorded.id);
  assert.equal(artifact.answers_source, 'form');
  assert.deepEqual(artifact.answers.map((item) => item.answer).sort(), ['Actual experience', 'Revised bidder answer']);
  assert.deepEqual((await drafts.latest(user, workspace.id)).answers.map((item) => item.answer).sort(), ['Actual experience', 'Revised bidder answer']);
  const savedCapture = recorded.application_form_json;
  await db.jobApplication.update({ where: { id: recorded.id }, data: { application_form_json: null } });
  assert.deepEqual((await applications.getResume(user, recorded.id)).answers, [], 'legacy AI suggestions must not be reported as actual answers');
  await db.jobApplication.update({ where: { id: recorded.id }, data: { application_form_json: savedCapture } });
  await assert.rejects(drafts.saveFormStep(user, prepared.draft.id, capturedStep('Questions', 'Too late', capturedAt + 2)), (error) => error.getStatus() === 409);

  calls.length = 0;
  assert.equal((await generation.generate(user, input('Acme'))).duplicate, true);
  assert.deepEqual(calls, []);
  assert.equal(await count(), 1);
  await assert.rejects(drafts.discard(user, prepared.draft.id), /submitted application cannot be discarded/);
  assert.equal((await generation.generate(user, input('RejectedCo', 'This role requires security clearance.'))).eligible, false);
  assert.equal(await db.resumeGenerationReservation.count(), 0, 'Rejected jobs release the claim');
  assert.equal(await count(), 1);
  await banned.create('Banned Company', user.id);
  calls.length = 0;
  assert.equal((await generation.generate(user, input('Banned Company'))).banned, true);
  assert.deepEqual(calls, []);
  const stale = await generation.generate(user, input('New Ban'));
  await banned.create('New Ban', user.id);
  await assert.rejects(drafts.submit(user, stale.draft.id, file, true), /now banned/);
  assert.equal(await count(), 1);
  const anotherGeneration = new ApplicationGenerationService(db, access, duplicates, banned, applications, {}, drafts, aiSettings);
  anotherGeneration.generateText = generation.generateText;
  anotherGeneration.requestProvider = generation.requestProvider;
  calls.length = 0;
  const concurrent = await Promise.all([generation.generate(user, input('ConcurrentCo')), anotherGeneration.generate(user, input('ConcurrentCo'))]);
  assert.equal(concurrent.filter((result) => result.success).length, 1);
  assert.equal(concurrent.filter((result) => result.duplicate).length, 1);
  assert.equal(calls.filter((operation) => operation === 'resume_generation').length, 1, 'Competing requests generate only one resume');
  const firstConcurrent = concurrent.find((result) => result.success);
  const oldConcurrent = await legacyDraft(firstConcurrent.draft.id, true);
  const committed = await Promise.all([firstConcurrent, oldConcurrent].map((value) => drafts.submit(user, value.draft.id, file, true)));
  assert.deepEqual(committed.map((value) => value.application.application_status).sort(), ['Applied', 'Duplicated']);
  assert.equal(await pay(), 2);
  assert.equal(await db.applicationScreenshot.count(), 3);
  const sameUrl = input('URLRaceCo');
  calls.length = 0;
  const urlDrafts = await Promise.all([generation.generate(user, sameUrl), anotherGeneration.generate(user, sameUrl)]);
  assert.equal(urlDrafts.filter((result) => result.success).length, 1);
  assert.equal(urlDrafts.filter((result) => result.duplicate).length, 1);
  assert.equal(calls.filter((operation) => operation === 'resume_generation').length, 1);
  const firstUrlDraft = urlDrafts.find((result) => result.success);
  const oldUrlDraft = await legacyDraft(firstUrlDraft.draft.id);
  await drafts.submit(user, firstUrlDraft.draft.id, file, true);
  await assert.rejects(drafts.submit(user, oldUrlDraft.draft.id, file, true), /already in the application table/);
  assert.equal(await db.applicationScreenshot.count(), 4);
  assert.equal(await count(), 4);

  const confirmationUrl = 'https://www.linkedin.com/jobs/';
  await assert.rejects(failingDrafts.submit(user, manual.draft.id, file, true, confirmationUrl), /simulated screenshot failure/);
  assert.equal(await count(), 4, 'Manual submission rolls back when the screenshot cannot be saved');
  calls.length = 0;
  assert.equal((await generation.generate(user, { ...input('Manual Company'), mode: 'manual', url: undefined })).duplicate_type, 'prepared');
  assert.equal((await generation.generate(user, input('Manual Company'))).duplicate_type, 'prepared');
  assert.deepEqual(calls, [], 'Manual and linked requests share the prepared company check');
  const manualRepeat = await legacyDraft(manual.draft.id);
  const manualOther = await generation.generate(user, { ...input('Another Manual Company'), mode: 'manual', url: undefined });
  const manualSaved = await Promise.all([
    drafts.submit(user, manual.draft.id, file, true, confirmationUrl),
    drafts.submit(user, manual.draft.id, file, true, confirmationUrl),
  ]);
  assert.equal(manualSaved.filter((result) => result.already_added).length, 1);
  assert.equal(manualSaved[0].application.id, manualSaved[1].application.id);
  const manualRow = await db.jobApplication.findUniqueOrThrow({ where: { id: manualSaved[0].application.id } });
  assert.equal(manualRow.url, confirmationUrl);
  assert.equal(manualRow.job_source, 'LinkedIn');
  assert.equal(manualRow.application_status, 'Applied');
  assert.equal(manualRow.company_name, 'Manual Company');
  assert.equal(JSON.parse(manualRow.application_answers_json)[0].answer, 'It fits my experience.');
  assert.equal((await drafts.submit(user, manualRepeat.draft.id, file, true, confirmationUrl)).application.application_status, 'Duplicated');
  assert.equal((await drafts.submit(user, manualOther.draft.id, file, true, confirmationUrl)).application.application_status, 'Applied');
  const manualRows = await db.jobApplication.findMany({ where: { url: confirmationUrl } });
  assert.equal(new Set(manualRows.map((row) => row.normalized_url)).size, 3, 'Shared confirmation pages are not treated as the same job URL');
  assert.equal(await db.applicationScreenshot.count(), 7);
  assert.equal(await count(), 7);
  assert.equal(await pay(), 5, 'Manual applied rows count toward payment; company duplicates do not');
  assert.ok((await drafts.latest(user, workspace.id, 'manual')).submitted_at);
  const manualBanned = await generation.generate(user, { ...input('Manual Ban'), mode: 'manual', url: undefined });
  await banned.create('Manual Ban', user.id);
  await assert.rejects(drafts.submit(user, manualBanned.draft.id, file, true, confirmationUrl), /now banned/);
  console.log('PASS: manual screenshot submission, saved page URL/source/documents, rollback, idempotent retries, shared confirmation pages, company duplicates, and payment counts');
  const retryInput = input('Retry Employer');
  const originalGenerateText = generation.generateText;
  generation.generateText = async () => { throw Error('Simulated provider failure'); };
  await assert.rejects(generation.generate(user, retryInput), /Simulated provider failure/);
  assert.equal(await db.resumeGenerationReservation.count(), 0, 'Provider failures release claims');
  generation.generateText = originalGenerateText;
  const retried = await generation.generate(user, retryInput);
  assert.equal(retried.success, true);
  await drafts.discard(user, retried.draft.id);
  await assert.rejects(drafts.submit(user, retried.draft.id, file, true), /Prepared job not found/);
  const regenerated = await generation.generate(user, retryInput);
  assert.equal(regenerated.success, true, 'Discarded jobs can be generated again');
  await drafts.discard(user, regenerated.draft.id);

  const target = { workspace_id: workspace.id, company_name: 'Lease Employer', url: 'https://jobs.example.test/lease' };
  const claim = await drafts.reserveGeneration(user, target);
  assert.ok(claim.id);
  await drafts.renewGeneration(claim.id);
  assert.equal((await drafts.reserveGeneration(user, { ...target, company_name: 'LEASE EMPLOYER, Inc.', url: '' })).blocked.duplicate_type, 'in_progress');
  assert.equal((await drafts.reserveGeneration(user, { ...target, company_name: 'Different Lease Employer' })).blocked.duplicate_type, 'in_progress');
  const secondWorkspace = await db.workspace.create({ data: { name: 'Independent profile', owner_user_id: user.id } });
  const independent = await drafts.reserveGeneration(user, { ...target, workspace_id: secondWorkspace.id });
  assert.ok(independent.id, 'Reservations are scoped to a profile');
  await drafts.releaseGeneration(independent.id);
  await db.resumeGenerationReservation.update({ where: { id: claim.id }, data: { expires_at: new Date(Date.now() - 1000) } });
  await assert.rejects(drafts.renewGeneration(claim.id), /reservation expired/);
  const replacement = await drafts.reserveGeneration(user, target);
  assert.ok(replacement.id && replacement.id !== claim.id, 'Interrupted generations expire and can be retried');
  await drafts.releaseGeneration(claim.id);
  assert.equal(await db.resumeGenerationReservation.count(), 1, 'An old request cannot release the new claim');
  await assert.rejects(drafts.prepare(user, { ...target, normalized_url: 'jobs.example.test/lease', job_title: 'Engineer',
    source_job_description: 'JD', job_description: 'JD', generated_resume_json: '{}' }, claim.id), /reservation expired/);
  await drafts.releaseGeneration(replacement.id);
  assert.equal(await db.resumeGenerationReservation.count(), 0);
  console.log('PASS: early prepared-job and company checks across manual/linked modes, one paid generation across concurrent workers, draft ownership/discard/retry, and reservation expiry/recovery');
  let finishGeneration;
  let backgroundCalls = 0;
  const delayedGeneration = { generate: async () => {
    backgroundCalls++;
    await new Promise((resolve) => { finishGeneration = resolve; });
    return { conversation_id: prepared.conversation_id, eligible: true };
  } };
  const worker = new GenerationJobsService(db, access, delayedGeneration);
  const secondWorker = new GenerationJobsService(db, access, delayedGeneration);
  const requestId = randomUUID();
  const jobInput = input('BackgroundCo');
  const submittedJobs = await Promise.all(Array.from({ length: 3 }, () => worker.submit(user, 'application', jobInput, requestId)));
  assert.equal(new Set(submittedJobs.map((job) => job.job_id)).size, 1);
  assert.equal(await db.generationJob.count(), 1);
  assert.equal(backgroundCalls, 0, 'submission returns before provider work starts');
  await assert.rejects(worker.get(other, requestId), /not found/);
  await Promise.all([worker.dispatch(), secondWorker.dispatch()]);
  for (let tries = 0; !finishGeneration && tries < 100; tries++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(backgroundCalls, 1, 'concurrent workers must not send the same paid request twice');
  assert.equal((await worker.get(user, requestId)).status, 'running');
  finishGeneration();
  await Promise.all([...worker.active.values(), ...secondWorker.active.values()]);
  assert.equal((await secondWorker.get(user, requestId)).result.conversation_id, prepared.conversation_id);
  assert.equal((await worker.submit(user, 'application', jobInput, requestId)).status, 'completed');
  assert.equal(backgroundCalls, 1);
  const interrupted = await worker.submit(user, 'application', jobInput);
  await db.generationJob.update({ where: { id: interrupted.job_id }, data: { status: 'running', lease_expires_at: new Date(Date.now() - 1000) } });
  await secondWorker.maintain();
  assert.equal((await worker.get(user, interrupted.job_id)).status, 'failed');
  assert.equal((await db.generationJob.findUnique({ where: { id: interrupted.job_id } })).request_json, null);
  worker.onModuleDestroy(); secondWorker.onModuleDestroy();
  console.log('PASS: draft/form/cache/job migrations, local conversation and answer reuse, actual captured answers, atomic submission, duplicate exclusion, idempotent background jobs, concurrent worker claims, and interrupted-job recovery');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await db.$disconnect();
  if (createdSchema && /^application_workflow_test_[a-f0-9]{32}$/.test(schema)) await root.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await root.$disconnect();
});
