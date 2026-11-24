const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadClient, deferred, hookHarness } = require('./client-test-harness.cjs');

const { loginRedirectTarget } = loadClient('lib/login-redirect.ts');
test('login redirects reject executable, external and looping destinations', () => {
  for (const value of [null, '', 'javascript:alert(1)', 'data:text/html,test', 'https://outside.test',
    '//outside.test', '/\\outside.test', '/\n/outside.test', '/\t/outside.test',
    '/a/..//outside.test', '/a/%2e%2e//outside.test', '/login?next=/login', '/a/../login']) {
    assert.equal(loginRedirectTarget(value), '/workspaces', String(value));
  }
  assert.equal(loginRedirectTarget('/workspaces/123?tab=files#resume'), '/workspaces/123?tab=files#resume');
});

function apiFixture(initialToken = 'old-token') {
  let token = initialToken;
  const pending = [];
  const window = { location: { pathname: '/account', href: '/account' }, localStorage: {
    getItem: () => token, setItem: (_key, value) => { token = value; }, removeItem: () => { token = null; },
  } };
  const client = loadClient('lib/api.ts', {}, { window, fetch: (...args) => {
    const response = deferred(); pending.push({ ...response, args }); return response.promise;
  } });
  return { ...client, window, pending };
}
const json = (message, status) => new Response(JSON.stringify({ message }), { status, headers: { 'content-type': 'application/json' } });

test('invalid sign-in shows the credential error without clearing an existing session', async () => {
  const fixture = apiFixture();
  const result = fixture.api.login('user@example.test', 'wrong');
  fixture.pending[0].resolve(json('Invalid email or password', 401));
  await assert.rejects(result, /Invalid email or password/);
  assert.equal(fixture.tokenStore.get(), 'old-token');
  assert.equal(fixture.window.location.href, '/account');
});

for (const kind of ['JSON', 'download']) {
  test(`a stale ${kind} 401 cannot clear a newly signed-in session`, async () => {
    const fixture = apiFixture();
    const result = kind === 'JSON' ? fixture.api.me() : fixture.api.getApplicationScreenshot('application-1');
    fixture.tokenStore.set('new-token');
    fixture.pending[0].resolve(json('Unauthorized', 401));
    await assert.rejects(result, /session has expired/);
    assert.equal(fixture.tokenStore.get(), 'new-token');
    assert.equal(fixture.window.location.href, '/account');
  });
  test(`an expired ${kind} session clears its token and returns to sign-in`, async () => {
    const fixture = apiFixture();
    const result = kind === 'JSON' ? fixture.api.me() : fixture.api.getApplicationScreenshot('application-1');
    fixture.pending[0].resolve(json('Unauthorized', 401));
    await assert.rejects(result, /session has expired/);
    assert.equal(fixture.tokenStore.get(), null);
    assert.equal(fixture.window.location.href, '/login?next=%2Faccount');
  });
}

test('changing filters keeps the new page in flight when the old request finishes', async () => {
  const hooks = hookHarness();
  const requests = [];
  const { useApplications } = loadClient('lib/use-applications.ts', { react: hooks.react, './api': {
    api: { listApplications: (...args) => { const next = deferred(); requests.push({ ...next, args }); return next.promise; } },
  } });
  let filters = { search: 'old' };
  hooks.mount(() => useApplications('workspace-1', filters));
  filters = { search: 'new' };
  hooks.render();
  assert.equal(requests.length, 2);
  requests[0].resolve({ total: 1, items: [{ id: 'old-row' }], start_cursor: null, end_cursor: null });
  await hooks.settle();
  assert.equal(hooks.value.loading, true);
  hooks.value.ensureRange(0, 0);
  assert.equal(requests.length, 2, 'Do not duplicate the current in-flight request');
  assert.equal(hooks.value.getRow(0), undefined);
  requests[1].resolve({ total: 1, items: [{ id: 'new-row' }], start_cursor: null, end_cursor: null });
  await hooks.settle();
  assert.equal(hooks.value.loading, false);
  assert.equal(hooks.value.getRow(0).id, 'new-row');
});

test('removing the active workspace clears loading even while its old request is pending', () => {
  const hooks = hookHarness();
  const { useApplications } = loadClient('lib/use-applications.ts', { react: hooks.react, './api': {
    api: { listApplications: () => new Promise(() => {}) },
  } });
  let workspace = 'workspace-1';
  const filters = {};
  hooks.mount(() => useApplications(workspace, filters));
  assert.equal(hooks.value.loading, true);
  workspace = null;
  hooks.render();
  assert.equal(hooks.value.loading, false);
});

function authFixture() {
  const hooks = hookHarness();
  let token = 'old-token';
  const profile = deferred(), login = deferred();
  const pushes = [];
  const { AuthProvider } = loadClient('lib/auth-context.tsx', { react: hooks.react,
    'react/jsx-runtime': { jsx: (_type, props) => props },
    'next/navigation': { useRouter: () => ({ push: (path) => pushes.push(path) }) },
    './api': { api: { me: () => profile.promise, login: () => login.promise }, tokenStore: {
      get: () => token, set: (next) => { token = next; }, clear: () => { token = null; },
    } },
  });
  hooks.mount(() => AuthProvider({ children: null }).value);
  return { hooks, profile, login, pushes, get token() { return token; } };
}

test('a pending profile refresh cannot restore the user after logout', async () => {
  const app = authFixture();
  app.hooks.value.logout();
  app.profile.resolve({ id: 'old-user' });
  await app.hooks.settle();
  assert.equal(app.hooks.value.user, null);
  assert.equal(app.hooks.value.loading, false);
  assert.equal(app.token, null);
});

test('an old profile refresh cannot replace a newly signed-in user', async () => {
  const app = authFixture();
  const login = app.hooks.value.login('new@example.test', 'password');
  app.login.resolve({ access_token: 'new-token', user: { id: 'new-user' } });
  await login;
  app.profile.resolve({ id: 'old-user' });
  await app.hooks.settle();
  assert.equal(app.hooks.value.user.id, 'new-user');
  assert.equal(app.hooks.value.loading, false);
  assert.equal(app.token, 'new-token');
});

test('a pending login cannot restore a session after logout', async () => {
  const app = authFixture();
  const login = app.hooks.value.login('new@example.test', 'password');
  app.hooks.value.logout();
  app.login.resolve({ access_token: 'new-token', user: { id: 'new-user' } });
  await login;
  await app.hooks.settle();
  assert.equal(app.hooks.value.user, null);
  assert.equal(app.token, null);
});
