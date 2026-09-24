import 'dotenv/config';
import { PrismaClient as PostgresClient } from '@prisma/client';
import { PrismaClient as SqliteClient } from '../prisma/generated/sqlite-client';

const sqliteUrl = process.env.SQLITE_DATABASE_URL?.trim();
const postgresUrl = process.env.DATABASE_URL?.trim();
const BATCH_SIZE = 500;

if (!sqliteUrl?.startsWith('file:')) {
  throw new Error('SQLITE_DATABASE_URL must be a file: URL pointing to the legacy SQLite database');
}
if (!postgresUrl || (!postgresUrl.startsWith('postgresql://') && !postgresUrl.startsWith('postgres://'))) {
  throw new Error('DATABASE_URL must point to the destination PostgreSQL database');
}

const source = new SqliteClient({ datasources: { db: { url: sqliteUrl } } });
const target = new PostgresClient({ datasources: { db: { url: postgresUrl } } });

async function copyInPages(
  label: string,
  sourceDelegate: any,
  targetDelegate: any,
  options: {
    optional?: boolean;
    mapRows?: (rows: Array<{ id: string }>) => Array<{ id: string }>;
  } = {},
) {
  let copied = 0;
  let cursor: string | undefined;

  while (true) {
    let rows: Array<{ id: string }>;
    try {
      rows = await sourceDelegate.findMany({
        take: BATCH_SIZE,
        orderBy: { id: 'asc' },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
    } catch (error: any) {
      if (options.optional && error?.code === 'P2021') {
        console.log(`${label}: source table is absent; skipping`);
        return;
      }
      throw error;
    }

    if (rows.length === 0) break;
    const prepared = options.mapRows ? options.mapRows(rows) : rows;
    const result = await targetDelegate.createMany({ data: prepared });
    copied += result.count;
    cursor = rows.at(-1)!.id;
  }

  console.log(`${label}: ${copied}`);
}

async function assertTargetIsEmpty(client: any) {
  const counts = await Promise.all([
    client.user.count(),
    client.workspace.count(),
    client.resumeProfile.count(),
    client.jobApplication.count(),
    client.paymentReport.count(),
    client.bannedUrlPattern.count(),
    client.resumeConversation.count(),
  ]);
  if (counts.some((count) => count > 0)) {
    throw new Error('Destination PostgreSQL database is not empty; refusing to merge or overwrite data');
  }
}

async function main() {
  await Promise.all([source.$connect(), target.$connect()]);

  // Determine the active winner for each URL before opening the destination transaction. Current
  // PostgreSQL enforces one Pending/Applied row globally, so legacy excess rows become Duplicated
  // instead of being dropped or causing the migration to fail.
  const activeRows = await source.jobApplication.findMany({
    where: { application_status: { in: ['Pending', 'Applied'] } },
    select: {
      id: true,
      normalized_url: true,
      paid: true,
      application_status: true,
      created_at: true,
    },
  });
  activeRows.sort((a, b) => (
    a.normalized_url.localeCompare(b.normalized_url) ||
    Number(b.paid) - Number(a.paid) ||
    Number(b.application_status === 'Applied') - Number(a.application_status === 'Applied') ||
    a.created_at.getTime() - b.created_at.getTime() ||
    a.id.localeCompare(b.id)
  ));
  const seenActiveUrls = new Set<string>();
  const duplicateIds = new Set<string>();
  for (const row of activeRows) {
    if (seenActiveUrls.has(row.normalized_url)) duplicateIds.add(row.id);
    else seenActiveUrls.add(row.normalized_url);
  }

  // Legacy SQLite stores the profile foreign key on Workspace and permits sharing. PostgreSQL now
  // owns one profile from ResumeProfile.workspace_id, so build a lossless one-to-one projection.
  const [legacyWorkspaces, legacyProfiles] = await Promise.all([
    source.workspace.findMany({ orderBy: { id: 'asc' } }),
    source.resumeProfile.findMany(),
  ]);
  const legacyProfileById = new Map(legacyProfiles.map((profile) => [profile.id, profile]));
  const profileUseCount = new Map<string, number>();
  const targetProfileIdByWorkspace = new Map<string, string>();
  const primaryWorkspaceByLegacyProfile = new Map<string, string>();
  const targetProfiles = legacyWorkspaces.map((workspace) => {
    const legacyProfile = workspace.resume_profile_id
      ? legacyProfileById.get(workspace.resume_profile_id)
      : undefined;
    if (!legacyProfile) {
      const id = `workspace_profile_${workspace.id}`;
      targetProfileIdByWorkspace.set(workspace.id, id);
      return {
        id,
        workspace_id: workspace.id,
        name: `Profile for ${workspace.id}`,
        updated_at: new Date(),
      };
    }

    const useCount = profileUseCount.get(legacyProfile.id) ?? 0;
    profileUseCount.set(legacyProfile.id, useCount + 1);
    const id = useCount === 0
      ? legacyProfile.id
      : `workspace_profile_clone_${legacyProfile.id}_${workspace.id}`;
    targetProfileIdByWorkspace.set(workspace.id, id);
    if (useCount === 0) primaryWorkspaceByLegacyProfile.set(legacyProfile.id, workspace.id);
    const {
      id: _id,
      user_id: _userId,
      created_by_user_id: _creatorId,
      ...profileData
    } = legacyProfile;
    return { ...profileData, id, workspace_id: workspace.id };
  });

  const configuredTimeout = Number(process.env.MIGRATION_TRANSACTION_TIMEOUT_MINUTES ?? 60);
  const timeoutMinutes = Number.isFinite(configuredTimeout)
    ? Math.min(240, Math.max(5, configuredTimeout))
    : 60;
  await target.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(734927451012345680::bigint)`;
    await assertTargetIsEmpty(tx);

    const users = await source.user.findMany();
    const usersWithoutCreators = users.map(({ created_by_user_id: _creator, ...user }) => ({
        ...user,
        created_by_user_id: null,
      }));
    await tx.user.createMany({ data: usersWithoutCreators });
    console.log(`users: ${usersWithoutCreators.length}`);
    for (const user of users) {
      if (user.created_by_user_id) {
        await tx.user.update({
          where: { id: user.id },
          data: { created_by_user_id: user.created_by_user_id },
        });
      }
    }

    const workspaceRows = legacyWorkspaces.map(({ resume_profile_id: _profileId, ...workspace }) => workspace);
    await tx.workspace.createMany({ data: workspaceRows });
    console.log(`workspaces: ${workspaceRows.length}`);
    await tx.resumeProfile.createMany({ data: targetProfiles });
    console.log(`resume profiles: ${targetProfiles.length}`);
    await copyInPages('job applications', source.jobApplication, tx.jobApplication, {
      mapRows: (rows) => rows.map((row: any) => duplicateIds.has(row.id)
        ? { ...row, application_status: 'Duplicated' }
        : row),
    });
    await copyInPages('payment reports', source.paymentReport, tx.paymentReport);
    await copyInPages('banned URL patterns', source.bannedUrlPattern, tx.bannedUrlPattern);
    await copyInPages(
      'resume conversations',
      source.resumeConversation,
      tx.resumeConversation,
      {
        optional: true,
        mapRows: (rows) => rows.map((row: any) => {
          const workspaceId = row.workspace_id
            ?? primaryWorkspaceByLegacyProfile.get(row.profile_id);
          const profileId = workspaceId
            ? targetProfileIdByWorkspace.get(workspaceId)
            : undefined;
          if (!workspaceId || !profileId) {
            throw new Error(`Resume conversation ${row.id} references an orphan profile`);
          }
          return { ...row, workspace_id: workspaceId, profile_id: profileId };
        }),
      },
    );
  }, { timeout: timeoutMinutes * 60_000, maxWait: 30_000 });

  console.log('SQLite to PostgreSQL migration completed successfully.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([source.$disconnect(), target.$disconnect()]);
  });
