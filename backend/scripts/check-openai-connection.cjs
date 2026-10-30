// Run after building: npm run check:ai -- <admin email or id>. Does not generate text.
require('dotenv').config({ path: require('node:path').join(__dirname, '../.env') });
require('reflect-metadata');
const { PrismaClient } = require('@prisma/client');
const { AiSettingsService } = require('../dist/ai/ai-settings.service');
const db = new PrismaClient();

async function main() {
  const selector = process.argv[2]?.trim();
  if (!selector) throw Error('Usage: npm run check:ai -- <admin email or id>');
  const admin = await db.user.findFirst({ where: { OR: [{ id: selector }, { email: selector }],
    role: { in: ['admin', 'super_admin'] }, is_active: true } });
  if (!admin) throw Error('An active admin with that email or id was not found');
  const { apiKey: key, model, provider, baseUrl } = await new AiSettingsService(db).forAdmin(admin.id);
  console.log(JSON.stringify({ node: process.version, admin_id: admin.id, provider, model, key_configured: true }));
  try {
    const endpoint = provider === 'openai' ? `/models/${encodeURIComponent(model)}` : '/models';
    const response = await fetch(`${baseUrl}${endpoint}`, {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => null);
    console.log(JSON.stringify({ status: response.status, request_id: response.headers.get('x-request-id'),
      model }));
    if (!response.ok) {
      const reason = response.status === 401 ? 'The configured API key was rejected'
        : response.status === 403 || response.status === 404 ? 'The configured model is not accessible to this API key'
          : 'The provider returned an upstream error';
      throw Error(`${reason} (HTTP ${response.status})`);
    }
    const accessible = provider === 'openai' ? data?.id === model
      : Array.isArray(data?.data) && data.data.some((item) => item.id === model);
    if (!accessible) throw Error('The selected model was not returned by the provider for this admin');
    console.log(`PASS: the server can reach ${provider} and access this admin's selected model`);
  } catch (error) {
    const codes = [];
    for (let cause = error; cause; cause = cause.cause) {
      if (cause.code) codes.push(cause.code);
      if (Array.isArray(cause.errors)) codes.push(...cause.errors.map((item) => item.code).filter(Boolean));
    }
    if (codes.length) console.error(JSON.stringify({ network_error_codes: [...new Set(codes)] }));
    throw error;
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
