const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(name, globals = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/renderer/src/lib', name + '.ts'), 'utf8').replaceAll('import.meta', '({ env: {} })'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = vm.createContext({ exports: {}, URL, URLSearchParams, ...globals });
  vm.runInContext(source, context);
  return context.exports;
}
const urls = load('job-page-url');
const posting = 'https://jobs.ashbyhq.com/acme/c06e4344-c7b0-4c1b-beb8-a9646594ff7c';
const other = 'https://jobs.ashbyhq.com/acme/384c9386-e81b-428a-96c8-50a730ebdce4';

test('Ashby posting, application and confirmation routes retain the same job identity', () => {
  for (const route of ['', '/application', '/application/confirmation', '/confirmation', '/submitted', '/thank-you', '/thank_you', '/success']) {
    assert.equal(urls.comparableJobUrl(posting + route + '?applicationId=receipt&source=LinkedIn#finished'), urls.comparableJobUrl(posting), route);
  }
});

test('different Ashby jobs, boards, domains and unknown routes never match', () => {
  for (const changed of [other, posting.replace('/acme/', '/other/'), posting.replace('jobs.ashbyhq.com', 'jobs.ashbyhq.com.example.test'),
    posting + '/another-job', posting + '/application/' + other.split('/').at(-1), 'https://jobs.ashbyhq.com/acme/confirmation',
    'https://jobs.ashbyhq.com/acme', 'https://jobs.ashbyhq.com/acme/not-a-posting-id/application']) {
    assert.notEqual(urls.comparableJobUrl(changed), urls.comparableJobUrl(posting), changed);
  }
});

test('other portals retain their identifying path and query values', () => {
  assert.equal(urls.comparableJobUrl('https://company.test/job?id=42&utm_source=li#apply'), 'company.test/job?id=42');
  assert.notEqual(urls.comparableJobUrl('https://company.test/job?id=42'), urls.comparableJobUrl('https://company.test/job?id=43'));
  assert.notEqual(urls.comparableJobUrl('https://company.test/job/42'), urls.comparableJobUrl('https://company.test/job/42/application'));
});

function browser(currentUrl) {
  const focused = [], created = [];
  const storage = load('extension-storage', {
    require: (name) => name === './job-page-url' ? urls : { withTimeout: (value) => value },
    chrome: { tabs: {
      get: async () => { if (!currentUrl) throw Error('Closed'); return { url: currentUrl }; },
      update: async (id, options) => focused.push({ id, ...options }),
      create: async (options) => { created.push(options); return { id: 99 }; },
    } },
  });
  return { focused, created, open: storage.openBrowserJobPage };
}

test('reopening a linked Ashby job focuses its confirmation tab without replacing the saved URL', async () => {
  const app = browser(posting + '/application/confirmation?applicationId=receipt');
  const result = await app.open(posting, 7);
  assert.equal(result.tabId, 7);
  assert.equal(result.url, posting);
  assert.deepEqual(app.focused, [{ id: 7, active: true }]);
  assert.equal(app.created.length, 0);
});

test('a closed tab or different posting opens the original job instead of capturing an unrelated page', async () => {
  for (const current of [null, other + '/application', 'chrome://newtab']) {
    const app = browser(current);
    const result = await app.open(posting, 7);
    assert.equal(result.tabId, 99);
    assert.equal(result.url, posting);
    assert.equal(app.focused.length, 0);
    assert.equal(app.created[0].url, posting);
  }
});

test('restoring a draft without a known tab ID binds capture to the active confirmation tab', async () => {
  const messages = [];
  const storage = load('extension-storage', {
    require: (name) => name === './job-page-url' ? urls : { withTimeout: (value) => value },
    chrome: { tabs: { query: async () => [{ id: 19 }] }, runtime: {
      sendMessage: async (message) => { messages.push(message); return { ok: true }; },
    } },
  });
  await storage.armApplicationScreenshot('draft', { profileTabId: 'profile-1', tabId: undefined, url: posting });
  assert.equal(messages[0].tabId, 19);
  assert.equal(messages[0].url, posting);
  assert.equal(messages[0].draftId, 'draft');
});
