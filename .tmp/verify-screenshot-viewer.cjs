const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.resolve(__dirname, '../../electron-app/node_modules/playwright-core'));

const now = new Date().toISOString();
const future = new Date(Date.now() + 86400000).toISOString();
const active = { captured_at: now, expires_at: future };
const rows = Array.from({ length: 600 }, (_, index) => ({
  id: `application-${index + 1}`, workspace_id: 'screenshot-test', date: now.slice(0, 10),
  number: index + 1, job_title: `Engineer ${String(index + 1).padStart(3, '0')}`,
  company_name: `Company ${String(index + 1).padStart(3, '0')}`,
  url: `https://example.com/jobs/${index + 1}`, normalized_url: `example.com/jobs/${index + 1}`,
  job_source: 'Other', application_status: 'Applied', pipeline_status: 'Not Started',
  interview_date: null, interview_note: null, note: '', paid: false,
  resume_generated_at: null, cover_letter_template: null,
  screenshot: [0, 550, 599].includes(index) ? active
    : index === 1 ? { captured_at: now, expires_at: '2020-01-01T00:00:00Z' } : null,
  created_by_user_id: 'test-user', created_at: now, updated_at: now,
}));
const requests = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

async function waitFor(assertion) {
  const deadline = Date.now() + 10000;
  while (true) {
    try { await assertion(); return; }
    catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('bidtracker_token', 'screenshot-test-token'));
    let failScreenshot = false;
    let failNavigation = false;
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const query = url.searchParams;
      const json = (body) => route.fulfill({ json: body });
      if (url.pathname === '/api/auth/me') return json({ id: 'test-user', username: 'tester', role: 'bidder', is_active: true });
      if (url.pathname === '/api/workspaces/screenshot-test') return json({
        id: 'screenshot-test', name: 'Screenshot review', owner: { id: 'test-user', username: 'tester' }, can_edit: true,
      });
      if (url.pathname === '/api/applications/summary') return json({ total: rows.length, paid: 0, by_application_status: { Applied: rows.length } });
      if (url.pathname.endsWith('/screenshot')) {
        if (failScreenshot) return route.fulfill({ status: 404, json: { message: 'Screenshot not found or has expired' } });
        return route.fulfill({ contentType: 'image/png', body: png });
      }
      if (url.pathname === '/api/applications') {
        requests.push(Object.fromEntries(query));
        if (failNavigation && query.get('has_screenshot') === 'true') {
          return route.fulfill({ status: 503, json: { message: 'Navigation temporarily unavailable' } });
        }
        let items = [...rows];
        const search = query.get('search');
        if (search) items = items.filter((row) => `${row.company_name} ${row.job_title}`.toLowerCase().includes(search.toLowerCase()));
        const sort = query.get('sort_by') || 'date';
        const direction = query.get('sort_dir') === 'asc' ? 1 : -1;
        items.sort((a, b) => sort === 'date' ? a.number - b.number : String(a[sort]).localeCompare(String(b[sort])) * direction);
        const cursor = query.get('cursor_after') || query.get('cursor_before');
        const cursorIndex = cursor ? items.findIndex((row) => row.id === cursor) : -1;
        if (cursor) items = query.has('cursor_before') ? items.slice(0, cursorIndex) : items.slice(cursorIndex + 1);
        if (query.get('has_screenshot') === 'true') items = items.filter((row) => row.screenshot && new Date(row.screenshot.expires_at) > new Date());
        const total = items.length;
        const size = Number(query.get('page_size'));
        const offset = cursor ? 0 : (Number(query.get('page')) - 1) * size;
        items = query.has('cursor_before') ? items.slice(-size) : items.slice(offset, offset + size);
        return json({ items, total: query.get('include_total') === 'false' ? null : total,
          page: 1, page_size: size, start_cursor: items[0]?.id || null, end_cursor: items.at(-1)?.id || null });
      }
      throw new Error(`Unexpected API request ${url.pathname}`);
    });
    await page.goto('http://localhost:3000/workspaces/screenshot-test');
    const opener = page.getByRole('button', { name: 'View screenshot for application 1', exact: true });
    await opener.waitFor();
    assert.equal(await page.getByRole('columnheader', { name: 'Screenshot', exact: true }).count(), 1);
    assert.equal(await page.getByText('Expired', { exact: true }).count(), 1);
    assert.ok(await page.getByText('No screenshot', { exact: true }).count() > 0);
    const grid = page.getByRole('grid');
    await grid.evaluate((element) => { element.scrollLeft = 1500; });
    const pinned = await opener.boundingBox();
    assert.ok(pinned.x < 300, 'Screenshot button remains pinned during horizontal scrolling');
    await opener.click();
    const dialog = page.getByRole('dialog');
    const next = dialog.getByRole('button', { name: 'Next', exact: false });
    const previous = dialog.getByRole('button', { name: 'Previous', exact: false });
    await waitFor(async () => assert.equal(await next.isEnabled(), true));
    assert.equal(await previous.isDisabled(), true);
    await page.keyboard.press('ArrowRight');
    await waitFor(async () => assert.match(await dialog.innerText(), /#551/));
    await waitFor(async () => assert.equal(await next.isEnabled(), true));
    assert.ok(requests.some((request) => request.cursor_after === 'application-1' && request.has_screenshot === 'true' && request.page_size === '1' && request.include_total === 'false'));
    await page.keyboard.press('ArrowRight');
    await waitFor(async () => assert.match(await dialog.innerText(), /#600/));
    await waitFor(async () => assert.equal(await previous.isEnabled(), true));
    assert.equal(await next.isDisabled(), true);
    await page.keyboard.press('ArrowRight');
    assert.match(await dialog.innerText(), /#600/);
    await page.keyboard.press('ArrowLeft');
    await waitFor(async () => assert.match(await dialog.innerText(), /#551/));
    await waitFor(async () => assert.equal(await previous.isEnabled(), true));
    await previous.click();
    await waitFor(async () => assert.match(await dialog.innerText(), /#1\b/));
    await waitFor(async () => assert.equal(await dialog.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0), true));
    const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('link', { name: 'Download' }).click()]);
    assert.match(download.suggestedFilename(), /application-.*-1-proof\.png/);
    const close = dialog.getByRole('button', { name: 'Close', exact: true });
    await close.focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await dialog.getByRole('link', { name: 'Download' }).evaluate((el) => el === document.activeElement), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await next.evaluate((el) => el === document.activeElement), true);
    await page.keyboard.press('Escape');
    assert.equal(await dialog.count(), 0);
    assert.equal(await opener.evaluate((el) => el === document.activeElement), true);
    console.log('PASS: pinned column, missing/expired states, cross-page arrow navigation, boundaries, PNG download, focus trap and Escape');

    await grid.evaluate((element) => { element.scrollLeft = 0; });
    const search = page.getByPlaceholder(/Search title/);
    await search.fill('Engineer 551');
    await page.getByRole('button', { name: 'View screenshot for application 551', exact: true }).click();
    await waitFor(async () => assert.ok(requests.some((request) => request.has_screenshot === 'true' && request.search === 'Engineer 551')));
    await waitFor(async () => assert.equal(await next.isDisabled(), true));
    assert.equal(await previous.isDisabled(), true);
    await page.keyboard.press('Escape');
    await search.fill('');
    await opener.waitFor();
    await page.getByRole('columnheader', { name: 'Job Title', exact: true }).click();
    await page.getByRole('button', { name: 'View screenshot for application 600', exact: true }).click();
    await waitFor(async () => assert.equal(await next.isEnabled(), true));
    await page.keyboard.press('ArrowRight');
    await waitFor(async () => assert.match(await dialog.innerText(), /#551/));
    assert.ok(requests.some((request) => request.cursor_after === 'application-600' && request.sort_by === 'job_title' && request.sort_dir === 'desc'));
    await page.keyboard.press('Escape');
    console.log('PASS: screenshot navigation preserves search and descending table sort');

    failScreenshot = true;
    failNavigation = true;
    await page.getByRole('button', { name: 'View screenshot for application 600', exact: true }).click();
    await dialog.getByText('Screenshot not found or has expired', { exact: true }).waitFor();
    await dialog.getByText('Navigation temporarily unavailable', { exact: false }).waitFor();
    failScreenshot = false;
    failNavigation = false;
    await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
    await waitFor(async () => assert.equal(await next.isEnabled(), true));
    await waitFor(async () => assert.equal(await dialog.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0), true));
    await close.click();
    assert.equal(await dialog.count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: screenshot and navigation error recovery; no browser runtime errors');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
