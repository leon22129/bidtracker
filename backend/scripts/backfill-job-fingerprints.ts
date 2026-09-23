import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createJobFingerprint } from '../src/common/utils/job-fingerprint.util';

const prisma = new PrismaClient();

async function main() {
  let updated = 0;
  for (;;) {
    const rows = await prisma.jobApplication.findMany({
      where: {
        job_fingerprint: null,
      },
      select: { id: true, company_name: true, job_title: true },
      orderBy: { id: 'asc' },
      take: 500,
    });
    if (!rows.length) break;
    await prisma.$transaction(
      rows.map((row) => {
        const companyName = row.company_name?.trim() || 'Unknown Company';
        const jobTitle = row.job_title?.trim() || 'Unknown Job Title';
        return prisma.jobApplication.update({
          where: { id: row.id },
          data: {
            company_name: companyName,
            job_title: jobTitle,
            job_fingerprint: createJobFingerprint(companyName, jobTitle),
          },
        });
      }),
    );
    updated += rows.length;
  }
  console.log(`Backfilled ${updated} job fingerprints.`);
}

main()
  .finally(() => prisma.$disconnect());
