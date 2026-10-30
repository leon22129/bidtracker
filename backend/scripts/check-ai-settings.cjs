// Exercises real migrations, authentication, persistence, and tenant isolation in a disposable schema.
require('dotenv').config();
require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
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
    .split(';').filter((statement) => !statement.includes('"ai_settings"')).join(';');
  const migrationSql = readFileSync(path.join(__dirname, '../prisma/migrations/20261030000000_ai_settings/migration.sql'), 'utf8');
  const promptMigrationSql = readFileSync(path.join(__dirname, '../prisma/migrations/20261030010000_admin_resume_prompt/migration.sql'), 'utf8');
  for (const statement of `${oldSql};${migrationSql};${promptMigrationSql}`.split(';').map((part) => part.trim()).filter(Boolean)) {
    await db.$executeRawUnsafe(statement);
  }
  const admin = await db.user.create({ data: { username: 'admin-a', email: 'admin-a@example.test', role: 'admin', password_hash: 'fixture' } });
  const other = await db.user.create({ data: { username: 'admin-b', email: 'admin-b@example.test', role: 'admin', password_hash: 'fixture' } });
  const bidder = await db.user.create({ data: { username: 'bidder', email: 'bidder@example.test', role: 'bidder', password_hash: 'fixture', created_by_user_id: admin.id } });
  const workspace = await db.workspace.create({ data: { name: 'AI test', owner_user_id: bidder.id, created_by_user_id: admin.id } });
  const module = await Test.createTestingModule({
    imports: [PrismaModule, AiSettingsModule, AuthModule], providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
  }).overrideProvider(PrismaService).useValue(db).compile();
  app = module.createNestApplication({ logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const jwt = module.get(JwtService);
  const token = (user) => jwt.sign({ sub: user.id, email: user.email, username: user.username, role: user.role });
  const request = async (user, route, data) => {
    const res = await fetch(`${base}${route}`, {
      method: data === undefined ? 'GET' : 'PATCH',
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
  const initial = await request(admin, '/ai-settings');
  assert.equal(initial.body.keys.openai.configured, false);
  assert.equal(initial.body.keys.deepseek.configured, false);
  await assert.rejects(settingsService.forWorkspace(workspace.id), /configure their own API key/);
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
  await assert.rejects(settingsService.forWorkspace(workspace.id), /configure their own OpenAI API key/);
  const secret = 'sk-test-only-never-send-to-provider';
  const saved = await request(admin, '/ai-settings', { provider: 'deepseek', model: 'deepseek-flash', api_key: secret });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.keys.deepseek.saved, true);
  assert.ok(!JSON.stringify(saved.body).includes(secret));
  assert.ok(!(await db.aiSettings.findUnique({ where: { admin_id: admin.id } })).deepseek_key.includes(secret));
  assert.equal((await request(other, '/ai-settings')).body.keys.deepseek.saved, false);
  assert.equal((await settingsService.forWorkspace(workspace.id)).apiKey, secret);
  assert.equal((await settingsService.forWorkspace(workspace.id)).resumePrompt, customPrompt);
  assert.equal((await request(admin, promptRoute, { resume_prompt: null })).body.resume_prompt, DEFAULT_RESUME_PROMPT);
  assert.equal((await settingsService.forWorkspace(workspace.id)).apiKey, secret);
  await request(admin, '/ai-settings', { provider: 'deepseek', model: 'deepseek-flash', remove_api_key: true });
  await assert.rejects(settingsService.forWorkspace(workspace.id), /configure their own DeepSeek API key/);
  const slack = await request(bidder, '/auth/slack-settings', { slack_user_id: ' u123bidder ' });
  assert.equal(slack.status, 200);
  assert.equal(slack.body.slack_user_id, 'U123BIDDER');
  assert.equal((await request(bidder, '/auth/slack-settings', { slack_webhook_url: null })).status, 403);
  assert.equal((await request(bidder, '/auth/slack-settings', { slack_user_id: '@channel' })).status, 400);
  assert.equal((await request(bidder, '/auth/slack-settings', { slack_user_id: '' })).body.slack_user_id, null);
  const publicUser = await request(admin, '/auth/me');
  assert.ok(!JSON.stringify(publicUser.body).includes(secret));
  console.log('PASS: PostgreSQL migrations, authenticated settings, encrypted keys without environment fallback, isolated prompt editing/reset, and optional bidder Slack IDs.');
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  if (app) await app.close();
  await db.$disconnect();
  if (created) await root.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await root.$disconnect();
});
