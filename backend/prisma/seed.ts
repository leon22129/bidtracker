/**
 * Development seed / load generator.
 *
 * Its real job is proving the performance requirement: `npm run seed -- --applications 50000` creates
 * a workspace at the specified scale so the virtualised table, the indexes and the pagination can be
 * measured against the actual target rather than against 20 rows.
 *
 *   npm run seed                          # users + workspaces + 2,000 applications
 *   npm run seed -- --applications 50000  # the stated performance target
 *   npm run seed -- --reset               # wipe applications first
 */
import 'dotenv/config';
import { Prisma, PrismaClient, Workspace } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { detectJobSource, normalizeUrl } from '../src/common/utils/url.util';
import { toDayStart } from '../src/common/utils/date.util';

const prisma = new PrismaClient();

const argv = process.argv.slice(2);
const argValue = (name: string, fallback: number) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(argv[i + 1] ?? fallback);
};
const TOTAL_APPLICATIONS = argValue('applications', 2000);
const RESET = argv.includes('--reset');

const COMPANIES = [
  'Stripe', 'Ramp', 'Vercel', 'Linear', 'Notion', 'Figma', 'Datadog', 'Snowflake', 'Databricks',
  'Airtable', 'Retool', 'Plaid', 'Brex', 'Deel', 'Rippling', 'Anduril', 'Scale AI', 'Cohere',
];
const TITLES = [
  'Senior Backend Engineer', 'Full Stack Engineer', 'Frontend Engineer', 'Platform Engineer',
  'Site Reliability Engineer', 'Data Engineer', 'Machine Learning Engineer', 'DevOps Engineer',
  'Staff Software Engineer', 'Engineering Manager', 'QA Engineer', 'Mobile Engineer',
];
const URL_TEMPLATES = [
  (c: string, i: number) => `https://boards.greenhouse.io/${c}/jobs/${4000000 + i}`,
  (c: string, i: number) => `https://jobs.lever.co/${c}/${i.toString(36)}-${i}`,
  (c: string, i: number) => `https://${c}.wd5.myworkdayjobs.com/en-US/careers/job/JR-${100000 + i}`,
  (c: string, i: number) => `https://jobs.smartrecruiters.com/${c}/74${300000 + i}`,
  (c: string, i: number) => `https://careers-${c}.icims.com/jobs/${5000 + i}/engineer/job`,
  (c: string, i: number) => `https://www.linkedin.com/jobs/view/${4010000000 + i}`,
  (c: string, i: number) => `https://www.indeed.com/viewjob?jk=${(i * 7919).toString(16)}`,
  (c: string, i: number) => `https://www.${c}.com/careers/${TITLES[i % TITLES.length].toLowerCase().replace(/\s+/g, '-')}-${i}`,
];

// Deterministic PRNG so repeated seeds produce identical data (makes perf comparisons meaningful).
let seed = 42;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];

async function main() {
  console.log(`Seeding ${TOTAL_APPLICATIONS} applications...`);

  if (RESET) {
    await prisma.jobApplication.deleteMany();
    await prisma.paymentReport.deleteMany();
    console.log('Cleared applications and payment reports.');
  }

  const passwordHash = await bcrypt.hash('Password123!', 10);

  const admin = await prisma.user.upsert({
    where: { email: (process.env.DEFAULT_ADMIN_EMAIL || 'admin@example.com').toLowerCase() },
    update: {},
    create: {
      email: (process.env.DEFAULT_ADMIN_EMAIL || 'admin@example.com').toLowerCase(),
      username: process.env.DEFAULT_ADMIN_USERNAME || 'admin',
      password_hash: await bcrypt.hash(process.env.DEFAULT_ADMIN_PASSWORD || 'Password123!', 10),
      role: 'super_admin',
    },
  });

  const bidders = await Promise.all(
    [
      { username: 'john', email: 'john@example.com', role: 'bidder' },
      { username: 'mike', email: 'mike@example.com', role: 'bidder_manager' },
      { username: 'sarah', email: 'sarah@example.com', role: 'bidder' },
    ].map((u) =>
      prisma.user.upsert({
        where: { email: u.email },
        update: {},
        create: { ...u, password_hash: passwordHash },
      }),
    ),
  );

  const workspaces: Workspace[] = [];
  for (const bidder of bidders) {
    const name = `${bidder.username.charAt(0).toUpperCase()}${bidder.username.slice(1)} Applications`;
    workspaces.push(
      await prisma.workspace.upsert({
        where: { name },
        update: {},
        create: { name, owner_user_id: bidder.id, created_by_user_id: admin.id },
      }),
    );
  }

  // Mike (bidder_manager) gets edit access to John's tab — the spec's exact example.
  const john = workspaces[0];
  const mike = bidders[1];
  await prisma.workspacePermission.upsert({
    where: { workspace_id_user_id: { workspace_id: john.id, user_id: mike.id } },
    update: { permission_type: 'edit' },
    create: { workspace_id: john.id, user_id: mike.id, permission_type: 'edit' },
  });

  console.log(`Users: ${admin.username} (admin), ${bidders.map((b) => b.username).join(', ')}`);
  console.log(`Workspaces: ${workspaces.map((w) => w.name).join(', ')}`);

  // Spread rows over the last ~120 days, numbering restarted per (workspace, date).
  const DAYS = 120;
  const perWorkspace = Math.floor(TOTAL_APPLICATIONS / workspaces.length);
  const seenNormalized = new Set<string>();
  let globalIndex = 0;
  let created = 0;

  for (const workspace of workspaces) {
    const perDay = Math.max(1, Math.round(perWorkspace / DAYS));

    for (let dayOffset = DAYS - 1; dayOffset >= 0; dayOffset--) {
      const date = toDayStart(new Date(Date.now() - dayOffset * 86400000));
      const startNumber =
        ((
          await prisma.jobApplication.aggregate({
            where: { workspace_id: workspace.id, date },
            _max: { number: true },
          })
        )._max.number ?? 0) + 1;

      const rows: Prisma.JobApplicationCreateManyInput[] = [];
      for (let i = 0; i < perDay; i++) {
        globalIndex++;
        const company = pick(COMPANIES);
        const slug = company.toLowerCase().replace(/\s+/g, '-');
        const url = pick(URL_TEMPLATES)(slug, globalIndex);
        const normalized = normalizeUrl(url);

        // ~4% intentional duplicates so duplicate handling and payment exclusion are exercised.
        const isDuplicate = seenNormalized.has(normalized) || rand() < 0.04;
        const dupUrl = isDuplicate && seenNormalized.size > 0 ? url : url;
        seenNormalized.add(normalized);

        const r = rand();
        const applicationStatus = isDuplicate
          ? 'Duplicated'
          : r < 0.62 ? 'Applied'
          : r < 0.82 ? 'Rejected'
          : 'Pending';

        const p = rand();
        const pipelineStatus =
          applicationStatus !== 'Applied' ? 'Not Started'
          : p < 0.78 ? 'Not Started'
          : p < 0.87 ? 'Recruiter Interview'
          : p < 0.93 ? 'Technical Interview'
          : p < 0.96 ? 'Final Interview'
          : p < 0.98 ? 'Offer Received'
          : 'Accepted';

        rows.push({
          workspace_id: workspace.id,
          date,
          number: startNumber + i,
          url: dupUrl,
          normalized_url: normalized,
          job_source: detectJobSource(url),
          job_title: rand() < 0.92 ? pick(TITLES) : null,
          company_name: rand() < 0.9 ? company : null,
          application_status: applicationStatus,
          pipeline_status: pipelineStatus,
          note: rand() < 0.25 ? 'Tailored resume, referred by network.' : null,
          resume_link: rand() < 0.4 ? `https://drive.example.com/resume-${globalIndex}.pdf` : null,
          // Older rows are already settled; recent ones are still open.
          paid: dayOffset > 21 && applicationStatus === 'Applied' && rand() < 0.85,
          created_by_user_id: pick(bidders).id,
        });
      }

      // Chunked createMany: at 50k rows, per-row inserts would take minutes on SQLite.
      for (let i = 0; i < rows.length; i += 500) {
        const res = await prisma.jobApplication.createMany({ data: rows.slice(i, i + 500) });
        created += res.count;
      }
    }
    console.log(`  ${workspace.name}: seeded`);
  }

  console.log(`Created ${created} applications.`);
  console.log('Login: admin as configured; bidders john/mike/sarah with password "Password123!"');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
