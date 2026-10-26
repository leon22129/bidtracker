// Run on the API server: npm run check:ai. Checks authentication/model access without generating text.
require('dotenv').config({ path: require('node:path').join(__dirname, '../.env') });

async function main() {
  const key = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL || 'gpt-6.1-sol';
  console.log(JSON.stringify({ node: process.version, model, key_configured: Boolean(key) }));
  if (!key) throw Error('OPENAI_API_KEY is not configured on this server');
  try {
    const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => null);
    console.log(JSON.stringify({ status: response.status, request_id: response.headers.get('x-request-id'),
      model: data?.id, error_code: data?.error?.code, error_type: data?.error?.type }));
    if (!response.ok) {
      const reason = response.status === 401 ? 'The configured API key was rejected'
        : response.status === 403 || response.status === 404 ? 'The configured model is not accessible to this API key'
          : 'The provider returned an upstream error';
      throw Error(`${reason} (HTTP ${response.status})`);
    }
    console.log('PASS: the server can reach OpenAI and access the configured model');
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

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
