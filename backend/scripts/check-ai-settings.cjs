// Exercises real migrations, authentication, persistence, and tenant isolation in a disposable schema.
require('dotenv').config();
require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes, createHash, createCipheriv } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { APP_GUARD } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');

const build = path.resolve(__dirname, '..', process.env.AI_CHECK_BUILD || 'dist');
const { AiSettingsModule } = require(path.join(build, 'ai/ai-settings.module'));
const { AiSettingsService } = require(path.join(build, 'ai/ai-settings.service'));
const { DEFAULT_RESUME_PROMPT } = require(path.join(build, 'ai/resume-prompt'));
const { AuthModule } = require(path.join(build, 'auth/auth.module'));
const { PrismaModule } = require(path.join(build, 'prisma/prisma.module'));
const { PrismaService } = require(path.join(build, 'prisma/prisma.service'));
const { JwtAuthGuard } = require(path.join(build, 'common/guards/jwt-auth.guard'));
const schema = `ai_settings_test_${randomUUID().replaceAll('-', '')}`;
assert.match(schema, /^ai_settings_test_[a-f0-9]{32}$/);
const root = new PrismaClient();
const address = new URL(process.env.DATABASE_URL);
address.searchParams.set('schema', schema);
const db = new PrismaClient({ datasources: { db: { url: address.toString() } } });
process.env.AI_SETTINGS_ENCRYPTION_KEY = randomUUID();
// Poison the old settings to prove the server never falls back to shared provider credentials.
process.env.OPENAI_API_KEY = 'environment-key-must-never-be-used';
process.env.DEEPSEEK_API_KEY = 'environment-key-must-never-be-used';
let app;
let created = false;

function legacyKey(value, adminId, provider) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(process.env.AI_SETTINGS_ENCRYPTION_KEY).digest(), iv);
  cipher.setAAD(Buffer.from(`${adminId}:${provider}`));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':');
}

async function main() {
  await root.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  created = true;
  const before = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'diff',
    '--from-empty', '--to-schema-datamodel', 'prisma/schema.prisma', '--script'], {
    encoding: 'utf8', timeout: 120000, windowsHide: true,
  });
  assert.equal(before.status, 0, 'Could not generate the isolated pre-feature schema');
  // Match the old schema, then apply the actual new migration. Avoid legacy pg_trgm search-path
  // assumptions that only work in the public schema of a normal installation.
  const oldSql = before.stdout.replace(/^\s*"reference_context" TEXT,\r?\n/gm, '')
    .split(';').filter((statement) => !statement.includes('"ai_settings"') && !statement.includes('"profile_ai_settings"')).join(';');
  const migrationSql = readFileSync(path.join(__dirname, '../prisma/migrations/20261030000000_ai_settings/migration.sql'), 'utf8');
  const promptMigrationSql = readFileSync(path.join(__dirname, '../prisma/migrations/20261030010000_admin_resume_prompt/migration.sql'), 'utf8');
  for (const statement of `${oldSql};${migrationSql};${promptMigrationSql}`.split(';').map((part) => part.trim()).filter(Boolean)) {
    await db.$executeRawUnsafe(statement);
  }
  const admin = await db.user.create({ data: { username: 'admin-a', email: 'admin-a@example.test', role: 'admin', password_hash: 'fixture' } });
  const other = await db.user.create({ data: { username: 'admin-b', email: 'admin-b@example.test', role: 'admin', password_hash: 'fixture' } });
  const bidder = await db.user.create({ data: { username: 'bidder', email: 'bidder@example.test', role: 'bidder', password_hash: 'fixture', created_by_user_id: admin.id } });
  const workspace = await db.workspace.create({ data: { name: 'AI test', owner_user_id: bidder.id, created_by_user_id: admin.id } });
  const second = await db.workspace.create({ data: { name: 'Second profile', owner_user_id: bidder.id, created_by_user_id: admin.id } });
  const foreign = await db.workspace.create({ data: { name: 'Other admin profile', owner_user_id: bidder.id, created_by_user_id: other.id } });
  const superAdmin = await db.user.create({ data: { username: 'super', email: 'super@example.test', role: 'super_admin', password_hash: 'fixture' } });
  const manager = await db.user.create({ data: { username: 'manager', email: 'manager@example.test', role: 'bidder_manager', password_hash: 'fixture', created_by_user_id: admin.id } });
  const profileRoute = (id) => `/workspaces/${id}/ai-settings`;
  const route = profileRoute(workspace.id);
  const module = await Test.createTestingModule({
    imports: [PrismaModule, AiSettingsModule, AuthModule], providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
  }).overrideProvider(PrismaService).useValue(db).compile();
  app = module.createNestApplication({ logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const jwt = module.get(JwtService);
  const token = (user) => jwt.sign({ sub: user.id, email: user.email, username: user.username, role: user.role });
  const request = async (user, route, data, method) => {
    const res = await fetch(`${base}${route}`, {
      method: method || (data === undefined ? 'GET' : 'PATCH'),
      headers: { ...(user ? { Authorization: `Bearer ${token(user)}` } : {}), 'Content-Type': 'application/json' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return { status: res.status, body: await res.json() };
  };
  assert.equal((await request(null, '/ai-settings')).status, 401);
  assert.equal((await request(bidder, '/ai-settings')).status, 403);
  assert.equal((await request(bidder, '/ai-settings', { provider: 'openai', model: 'gpt-6.1-sol' })).status, 403);
  assert.equal((await request(admin, '/ai-settings', { provider: 'deepseek', model: 'gpt-6.1-sol' })).status, 400);
  assert.equal((await request(admin, '/ai-settings', { provider: 'other', model: 'anything' })).status, 400);
  const settingsService = module.get(AiSettingsService);
  // Upgrade an existing row and verify both old encrypted keys and the custom prompt survive.
  await db.$executeRawUnsafe(`INSERT INTO "ai_settings" ("admin_id", "model", "openai_key", "deepseek_key", "resume_prompt", "updated_at") VALUES ($1, 'gpt-6.1-sol', 'old-openai', 'old-deepseek', 'old-prompt', CURRENT_TIMESTAMP)`, other.id);
  const providerMigrationSql = readFileSync(path.join(__dirname, '../prisma/migrations/20261123000000_gemini_claude/migration.sql'), 'utf8');
  for (const statement of providerMigrationSql.split(';').map((part) => part.trim()).filter(Boolean)) await db.$executeRawUnsafe(statement);
  const preserved = await db.aiSettings.findUnique({ where: { admin_id: other.id } });
  assert.equal(preserved.openai_key, 'old-openai');
  assert.equal(preserved.deepseek_key, 'old-deepseek');
  assert.equal(preserved.resume_prompt, 'old-prompt');
  await db.aiSettings.delete({ where: { admin_id: other.id } });
  await db.aiSettings.create({ data: { admin_id: admin.id, provider: 'deepseek', model: 'deepseek-flash',
    ...Object.fromEntries(['openai', 'deepseek', 'gemini', 'claude'].map((provider) => [`${provider}_key`, legacyKey(`migrated-${provider}`, admin.id, provider)])),
  } });
  const profileMigration = readFileSync(path.join(__dirname, '../prisma/migrations/20261123010000_profile_ai_settings/migration.sql'), 'utf8');
  for (const statement of profileMigration.split(';').map((part) => part.replace(/^--.*$/gm, '').trim()).filter(Boolean)) await db.$executeRawUnsafe(statement);
  assert.equal(await db.profileAiSettings.count(), 0, 'Existing profiles must inherit account settings, not receive automatic overrides');
  for (const provider of ['openai', 'deepseek', 'gemini', 'claude']) {
    assert.equal((await settingsService.forWorkspace(workspace.id, provider)).apiKey, `migrated-${provider}`);
    assert.equal((await settingsService.forWorkspace(second.id, provider)).apiKey, `migrated-${provider}`);
  }
  const initial = await request(admin, route);
  assert.equal(initial.body.provider, 'deepseek');
  assert.equal(initial.body.uses_account_defaults, true);
  assert.equal(initial.body.account_defaults.configured, true);
  assert.equal(initial.body.keys.deepseek.configured, false);
  assert.ok(!JSON.stringify(initial.body).includes('migrated-'));
  assert.equal((await request(admin, '/ai-settings')).body.keys.deepseek.saved, true);
  for (const denied of [bidder, manager]) {
    assert.equal((await request(denied, route)).status, 403);
    assert.equal((await request(denied, route, { provider: 'openai', model: 'gpt-6.1-sol', api_key: 'blocked' })).status, 403);
    assert.equal((await request(denied, route, undefined, 'DELETE')).status, 403);
  }
  assert.equal((await request(null, route)).status, 401);
  assert.equal((await request(null, route, undefined, 'DELETE')).status, 401);
  assert.equal((await request(other, route)).status, 404);
  assert.equal((await request(other, route, { provider: 'openai', model: 'gpt-6.1-sol' })).status, 404);
  assert.equal((await request(other, route, undefined, 'DELETE')).status, 404);
  assert.equal((await request(admin, profileRoute(foreign.id))).status, 404);
  assert.equal((await request(admin, route, { provider: 'claude', model: 'gemini-4-hydrogen' })).status, 400);
  assert.equal((await request(admin, route, { provider: 'openai', model: 'gpt-6.1-sol', api_key: 'key', admin_id: other.id })).status, 400);
  assert.equal((await request(admin, route, { provider: 'openai', model: 'gpt-6.1-sol' })).status, 400);
  assert.equal((await request(admin, route, { provider: 'openai', model: 'gpt-6.1-sol', remove_api_key: true })).status, 400);
  const fresh = await db.workspace.create({ data: { name: 'New profile', owner_user_id: bidder.id, created_by_user_id: admin.id } });
  assert.equal((await request(admin, profileRoute(fresh.id))).body.keys.openai.configured, false);
  assert.equal((await settingsService.forWorkspace(fresh.id)).apiKey, 'migrated-deepseek');
  await assert.rejects(settingsService.forWorkspace(foreign.id), /Account/);
  const promptRoute = '/ai-settings/resume-prompt';
  const customPrompt = `${DEFAULT_RESUME_PROMPT}\nPrefer concise accomplishments.`;
  assert.equal((await request(null, promptRoute, { resume_prompt: customPrompt })).status, 401);
  assert.equal((await request(bidder, promptRoute, { resume_prompt: customPrompt })).status, 403);
  assert.equal((await request(admin, promptRoute, {})).status, 400);
  assert.equal((await request(admin, promptRoute, { resume_prompt: 'Missing data placeholders' })).status, 400);
  assert.equal((await request(admin, promptRoute, { resume_prompt: 'a'.repeat(50001) })).status, 400);
  assert.equal((await request(admin, promptRoute, { resume_prompt: customPrompt, admin_id: other.id })).status, 400);
  const savedPrompt = await request(admin, promptRoute, { resume_prompt: customPrompt });
  assert.equal(savedPrompt.status, 200);
  assert.equal(savedPrompt.body.resume_prompt_customized, true);
  assert.equal((await request(admin, '/ai-settings')).body.resume_prompt, customPrompt);
  assert.equal((await request(other, '/ai-settings')).body.resume_prompt, DEFAULT_RESUME_PROMPT);
  assert.equal((await settingsService.forWorkspace(workspace.id)).resumePrompt, customPrompt);
  const secret = 'sk-test-only-never-send-to-provider';
  const saved = await request(admin, route, { provider: 'deepseek', model: 'deepseek-flash', api_key: secret });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.uses_account_defaults, false);
  assert.equal(saved.body.keys.deepseek.saved, true);
  assert.ok(!JSON.stringify(saved.body).includes(secret));
  const profileRow = await db.profileAiSettings.findUnique({ where: { workspace_id: workspace.id } });
  assert.match(profileRow.deepseek_key, /^v2:/);
  assert.ok(!profileRow.deepseek_key.includes(secret));
  assert.equal((await settingsService.forWorkspace(second.id)).apiKey, 'migrated-deepseek');
  assert.equal((await settingsService.forWorkspace(workspace.id)).apiKey, secret);
  assert.equal((await settingsService.forWorkspace(workspace.id)).resumePrompt, customPrompt);
  const accountSaved = await request(admin, '/ai-settings', { provider: 'deepseek', model: 'deepseek-v4-pro', api_key: 'updated-account-key' });
  assert.equal(accountSaved.status, 200);
  assert.ok(!JSON.stringify(accountSaved.body).includes('updated-account-key'));
  assert.equal((await settingsService.forWorkspace(second.id)).apiKey, 'updated-account-key');
  assert.equal((await settingsService.forWorkspace(second.id)).model, 'deepseek-v4-pro');
  assert.equal((await settingsService.forWorkspace(workspace.id)).apiKey, secret);
  assert.equal((await settingsService.forWorkspace(workspace.id)).model, 'deepseek-flash');
  assert.equal((await request(admin, route, { provider: 'deepseek', model: 'deepseek-v4-pro' })).status, 200);
  assert.equal((await settingsService.forWorkspace(workspace.id)).model, 'deepseek-v4-pro');
  assert.equal((await settingsService.forWorkspace(workspace.id)).apiKey, secret);
  assert.equal((await request(admin, promptRoute, { resume_prompt: null })).body.resume_prompt, DEFAULT_RESUME_PROMPT);
  assert.equal((await settingsService.forWorkspace(workspace.id)).apiKey, secret);
  const reset = await request(admin, route, undefined, 'DELETE');
  assert.equal(reset.status, 200);
  assert.equal(reset.body.uses_account_defaults, true);
  assert.equal(await db.profileAiSettings.count(), 0);
  assert.equal((await settingsService.forWorkspace(workspace.id)).apiKey, 'updated-account-key');
  for (const [provider, model] of [['gemini', 'gemini-4-hydrogen'], ['claude', 'claude-sonnet-5-5']]) {
    const key = `test-${provider}-key`;
    const result = await request(admin, route, { provider, model, api_key: key });
    assert.equal(result.status, 200);
    assert.equal(result.body.keys[provider].configured, true);
    assert.ok(!JSON.stringify(result.body).includes(key));
    const stored = await db.profileAiSettings.findUnique({ where: { workspace_id: workspace.id } });
    assert.match(stored[`${provider}_key`], /^v2:/);
    assert.ok(!stored[`${provider}_key`].includes(key));
    assert.equal((await settingsService.forWorkspace(workspace.id)).apiKey, key);
    assert.equal((await request(bidder, route, { provider, model, api_key: key })).status, 403);
    assert.equal((await request(admin, route, undefined, 'DELETE')).status, 200);
    assert.equal((await settingsService.forWorkspace(workspace.id)).apiKey, 'updated-account-key');
    assert.equal((await settingsService.forWorkspace(second.id, provider)).apiKey, `migrated-${provider}`);
  }
  assert.equal((await request(superAdmin, profileRoute(foreign.id), { provider: 'gemini', model: 'gemini-4-hydrogen', api_key: 'super-managed' })).status, 200);
  assert.equal((await settingsService.forWorkspace(foreign.id)).apiKey, 'super-managed');
  assert.equal((await request(superAdmin, profileRoute(foreign.id), undefined, 'DELETE')).body.uses_account_defaults, true);
  await assert.rejects(settingsService.forWorkspace(foreign.id), /Account/);
  await request(superAdmin, profileRoute(foreign.id), { provider: 'gemini', model: 'gemini-4-hydrogen', api_key: 'super-managed' });
  await db.workspace.update({ where: { id: workspace.id }, data: { owner_user_id: manager.id, manager_user_id: manager.id } });
  assert.equal((await settingsService.forWorkspace(workspace.id, 'openai')).apiKey, 'migrated-openai');
  await db.workspace.delete({ where: { id: foreign.id } });
  assert.equal(await db.profileAiSettings.count({ where: { workspace_id: foreign.id } }), 0);
  const slack = await request(bidder, '/auth/slack-settings', { slack_user_id: ' u123bidder ' });
  assert.equal(slack.status, 200);
  assert.equal(slack.body.slack_user_id, 'U123BIDDER');
  assert.equal((await request(bidder, '/auth/slack-settings', { slack_webhook_url: null })).status, 403);
  assert.equal((await request(bidder, '/auth/slack-settings', { slack_user_id: '@channel' })).status, 400);
  assert.equal((await request(bidder, '/auth/slack-settings', { slack_user_id: '' })).body.slack_user_id, null);
  const publicUser = await request(admin, '/auth/me');
  assert.ok(!JSON.stringify(publicUser.body).includes(secret));
  console.log('PASS: PostgreSQL migration preserves account defaults; live inheritance; complete profile overrides; reset to defaults; tenant/role authorization; reassignment; account prompts; cascading cleanup.');
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  if (app) await app.close();
  await db.$disconnect();
  if (created) await root.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await root.$disconnect();
});
