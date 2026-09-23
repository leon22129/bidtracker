/**
 * Latency benchmark against a running server. Backs the performance numbers in the README, and is the
 * thing to re-run after touching a query or an index.
 *
 * The point is to measure the paths the 50,000-row table actually uses: a page fetch at various
 * offsets, each filter, each sort, and the dashboard aggregates. Every figure is the median of five
 * runs after one warm-up, so it reflects a warm page cache rather than cold-start I/O.
 *
 *   DATABASE_URL="file:./perf.db" npx prisma migrate deploy
 *   DATABASE_URL="file:./perf.db" npm run seed -- --applications 150000 --reset   # 50k per workspace
 *   DATABASE_URL="file:./perf.db" node dist/main.js &
 *   SMOKE_ADMIN_EMAIL=... SMOKE_ADMIN_PASSWORD=... node perf.mjs
 */
const B = 'http://127.0.0.1:3001/api';
const RUNS = 5;

const login = async (email, password) => {
  const res = await fetch(`${B}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
};

const token = await login(
  process.env.SMOKE_ADMIN_EMAIL || 'admin@example.com',
  process.env.SMOKE_ADMIN_PASSWORD || 'devpassword',
);
const H = { Authorization: `Bearer ${token}` };

const get = async (path) => (await fetch(B + path, { headers: H })).json();
const workspaces = await get('/workspaces');
if (!workspaces.length) throw new Error('no workspaces — seed the database first');
const id = workspaces[0].id;
const wsTotal = (await get(`/applications?workspace_id=${id}&page_size=1`)).total;
const lastPage = Math.max(1, Math.ceil(wsTotal / 200));

console.log(`workspace under test: ${workspaces[0].name}   rows=${wsTotal}\n`);

async function time(label, path) {
  await get(path); // warm the page cache and the query plan
  const runs = [];
  let shape = '';
  for (let i = 0; i < RUNS; i++) {
    const t = Date.now();
    const body = await get(path);
    runs.push(Date.now() - t);
    if (i === RUNS - 1) {
      const n = Array.isArray(body) ? body.length : (body.items?.length ?? '-');
      shape = `rows=${n} total=${body.total ?? '-'}`;
    }
  }
  runs.sort((a, b) => a - b);
  console.log(`${String(runs[Math.floor(RUNS / 2)]).padStart(5)} ms   ${label.padEnd(38)} ${shape}`);
}

await time('first page (200)', `/applications?workspace_id=${id}&page=1&page_size=200`);
await time(`mid page (offset ${Math.floor(lastPage / 2) * 200})`, `/applications?workspace_id=${id}&page=${Math.max(1, Math.floor(lastPage / 2))}&page_size=200`);
await time(`last page (offset ${(lastPage - 1) * 200})`, `/applications?workspace_id=${id}&page=${lastPage}&page_size=200`);
await time('max page size (500)', `/applications?workspace_id=${id}&page=10&page_size=500`);
await time('status filter', `/applications?workspace_id=${id}&application_status=Applied&page_size=200`);
await time('status + source + paid', `/applications?workspace_id=${id}&application_status=Applied&job_source=Greenhouse&paid=false&page_size=200`);
await time('date range', `/applications?workspace_id=${id}&date_from=2026-06-01&date_to=2026-06-30&page_size=200`);
await time('free-text search', `/applications?workspace_id=${id}&search=Engineer&page_size=200`);
await time('sort by company (non-indexed column)', `/applications?workspace_id=${id}&sort_by=company_name&sort_dir=asc&page_size=200`);
await time('workspace summary', `/applications/summary?workspace_id=${id}`);
await time('analytics: conversion', '/analytics/conversion');
await time('analytics: full dashboard', '/analytics/overview');
await time('analytics: interviews by source', '/analytics/interviews-by-source');
await time('payments: report aggregation', '/payments/report');

const paymentReport = await get('/payments/report');
const paymentBidder = paymentReport.bidders?.[0];
const t = Date.now();
const gen = paymentBidder ? await fetch(`${B}/payments/process`, {
  method: 'POST',
  headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    bidder_id: paymentBidder.bidder_id,
    start_date: paymentReport.start_date.slice(0, 10),
    end_date: paymentReport.end_date.slice(0, 10),
  }),
}) : null;
console.log(`${String(Date.now() - t).padStart(5)} ms   ${'payments: process filtered update (write)'.padEnd(38)} status=${gen?.status ?? 'skipped'}`);
