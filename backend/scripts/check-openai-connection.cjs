// Run after building: npm run check:ai -- <workspace id>. Does not generate text.
require('dotenv').config({ path: require('node:path').join(__dirname, '../.env') });
require('reflect-metadata');
const { PrismaClient } = require('@prisma/client');
const { AiSettingsService } = require('../dist/ai/ai-settings.service');
const db = new PrismaClient();

async function main() {
  const selector = process.argv[2]?.trim();
  if (!selector) throw Error('Usage: npm run check:ai -- <workspace id>');
  const { apiKey: key, model, provider, baseUrl } = await new AiSettingsService(db).forWorkspace(selector);
  console.log(JSON.stringify({ node: process.version, workspace_id: selector, provider, model, key_configured: true }));
  try {
    const endpoint = provider === 'deepseek' ? '/models' : `/models/${encodeURIComponent(model)}`;
    const response = await fetch(`${baseUrl}${endpoint}`, {
      headers: provider === 'gemini' ? { 'x-goog-api-key': key }
        : provider === 'claude' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
        : { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000),
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
    const accessible = provider === 'gemini' ? data?.name === `models/${model}`
      : provider !== 'deepseek' ? data?.id === model
      : Array.isArray(data?.data) && data.data.some((item) => item.id === model);
    if (!accessible) throw Error('The selected model was not returned by the provider for this profile');
    console.log(`PASS: the server can reach ${provider} and access this profile's selected model`);
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
