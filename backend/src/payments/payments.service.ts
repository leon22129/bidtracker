import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { endOfDay, previousWeekRange, toDayStart } from '../common/utils/date.util';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';

type Period = { start_date: string; end_date: string; bidder_id?: string };
const PAYABLE_ROLES = ['bidder', 'bidder_manager'] as const;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
  ) {}

  async report(user: AuthUser, period: Partial<Period> = {}) {
    const range = this.resolvePeriod(period);
    const admin = user.role === 'admin' || user.role === 'super_admin';
    // Admins are constrained to workspaces they may inspect. Bidders are constrained by the
    // immutable application creator instead, so reassignment does not hide their historical work.
    const workspaceIds = admin ? await this.access.visibleWorkspaceIds(user) : null;
    if (workspaceIds?.length === 0) {
      return { start_date: range.start, end_date: range.end, bidders: [], managers: [], total_applied: 0 };
    }
    const bidderId = admin
      ? period.bidder_id
      : user.role === 'bidder' ? user.id : undefined;
    const creatorScope = user.role === 'bidder_manager'
      ? {
        role: { in: [...PAYABLE_ROLES] },
        OR: [{ id: user.id }, { manager_user_id: user.id }],
      }
      : { role: { in: [...PAYABLE_ROLES] } };

    const counts = await this.prisma.jobApplication.groupBy({
      by: ['created_by_user_id', 'workspace_id'],
      where: {
        application_status: 'Applied',
        paid: false,
        date: { gte: range.start, lte: endOfDay(range.end) },
        ...(workspaceIds ? { workspace_id: { in: workspaceIds } } : {}),
        ...(bidderId ? { created_by_user_id: bidderId } : {}),
        createdByUser: { is: creatorScope },
      },
      _count: { _all: true },
    });
    const creatorIds = [...new Set(counts
      .map((row) => row.created_by_user_id)
      .filter((id): id is string => Boolean(id)))];
    const [workspaces, creators] = counts.length
      ? await Promise.all([
        this.prisma.workspace.findMany({
          where: { id: { in: counts.map((row) => row.workspace_id) } },
          select: { id: true, name: true, resumeProfile: { select: { name: true } } },
        }),
        this.prisma.user.findMany({
          where: { id: { in: creatorIds } },
          select: {
            id: true,
            username: true,
            role: true,
            manager: { select: { id: true, username: true } },
          },
        }),
      ])
      : [[], []];
    const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
    const creatorById = new Map(creators.map((creator) => [creator.id, creator]));

    const bidders = new Map<string, { bidder_id: string; bidder_username: string; applied_count: number; workspaces: Array<{ workspace_id: string; workspace_name: string; applied_count: number }> }>();
    const managers = new Map<string, {
      manager_id: string | null;
      manager_username: string;
      applied_count: number;
      profiles: Array<{
        workspace_id: string;
        profile_name: string;
        bidder_id: string;
        bidder_username: string;
        applied_count: number;
      }>;
    }>();
    for (const row of counts) {
      const workspace = workspaceById.get(row.workspace_id);
      const creatorId = row.created_by_user_id;
      const creator = creatorId ? creatorById.get(creatorId) : null;
      if (!workspace || !creatorId || !creator) continue;
      const bidder = bidders.get(creatorId) ?? { bidder_id: creatorId, bidder_username: creator.username, applied_count: 0, workspaces: [] };
      bidder.applied_count += row._count._all;
      bidder.workspaces.push({ workspace_id: workspace.id, workspace_name: workspace.name, applied_count: row._count._all });
      bidders.set(creatorId, bidder);

      const managerId = creator.role === 'bidder_manager'
        ? creator.id
        : creator.manager?.id ?? null;
      const managerUsername = creator.role === 'bidder_manager'
        ? creator.username
        : creator.manager?.username ?? 'Unassigned';
      const managerKey = managerId ?? 'unassigned';
      const manager = managers.get(managerKey) ?? {
        manager_id: managerId,
        manager_username: managerUsername,
        applied_count: 0,
        profiles: [],
      };
      manager.applied_count += row._count._all;
      manager.profiles.push({
        workspace_id: workspace.id,
        profile_name: workspace.resumeProfile?.name ?? workspace.name,
        bidder_id: creator.id,
        bidder_username: creator.username,
        applied_count: row._count._all,
      });
      managers.set(managerKey, manager);
    }
    const bidderRows = [...bidders.values()].sort((a, b) => b.applied_count - a.applied_count);
    const managerRows = [...managers.values()]
      .map((manager) => ({
        ...manager,
        profiles: manager.profiles.sort((a, b) => (
          a.profile_name.localeCompare(b.profile_name)
          || a.bidder_username.localeCompare(b.bidder_username)
        )),
      }))
      .sort((a, b) => b.applied_count - a.applied_count || a.manager_username.localeCompare(b.manager_username));
    return {
      start_date: range.start,
      end_date: range.end,
      bidders: bidderRows,
      managers: managerRows,
      total_applied: bidderRows.reduce((total, bidder) => total + bidder.applied_count, 0),
    };
  }

  async process(user: AuthUser, period: Period) {
    if (user.role !== 'admin' && user.role !== 'super_admin') throw new ForbiddenException('Only an admin can process payment');
    if (!period.bidder_id) throw new BadRequestException('bidder_id is required');
    const range = this.resolvePeriod(period);
    const result = await this.prisma.$transaction(async (tx) => {
      const bidder = await tx.user.findFirst({
        where: { id: period.bidder_id, role: { in: [...PAYABLE_ROLES] } },
        select: { id: true },
      });
      if (!bidder) throw new BadRequestException('Bidder does not exist');

      const eligibleWhere = {
        application_status: 'Applied',
        paid: false,
        date: { gte: range.start, lte: endOfDay(range.end) },
        created_by_user_id: period.bidder_id,
        workspace: {
          ...(user.role === 'admin' ? { created_by_user_id: user.id } : {}),
        },
      } as const;
      const updated = await tx.jobApplication.updateMany({
        where: eligibleWhere,
        data: { paid: true },
      });
      if (updated.count === 0) {
        const existing = await tx.paymentReport.findFirst({
          where: {
            bidder_id: period.bidder_id,
            start_date: range.start,
            end_date: range.end,
            ...(user.role === 'admin' ? { processed_by: user.id } : {}),
          },
          orderBy: { processed_at: 'desc' },
        });
        if (existing) return { ...existing, already_processed: true };
      }
      const report = await tx.paymentReport.create({
        data: {
          bidder_id: period.bidder_id!,
          start_date: range.start,
          end_date: range.end,
          applied_count: updated.count,
          processed_by: user.id,
        },
      });
      return { ...report, already_processed: false };
    });
    return { id: result.id, bidder_id: result.bidder_id, start_date: result.start_date, end_date: result.end_date, applied_count: result.applied_count, processed_at: result.processed_at, already_processed: result.already_processed };
  }

  /** Settles the previous Monday-Sunday period once across all backend replicas. */
  async processPreviousWeekAutomatically(asOf: Date = new Date()) {
    const range = previousWeekRange(asOf);

    return this.prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>(Prisma.sql`
        SELECT pg_try_advisory_xact_lock(734927451012345678::bigint) AS acquired
      `);
      if (!lock?.acquired) {
        return {
          skipped: true,
          reason: 'another_backend_is_processing',
          start_date: range.start,
          end_date: range.end,
          reports: [],
          total_applied: 0,
        };
      }

      const eligibleBase = {
        application_status: 'Applied',
        paid: false,
        date: { gte: range.start, lte: endOfDay(range.end) },
      } as const;
      const bidders = await tx.user.findMany({
        where: {
          role: { in: [...PAYABLE_ROLES] },
          createdApplications: { some: eligibleBase },
        },
        select: { id: true },
      });

      const reports: Array<{ applied_count: number }> = [];
      for (const bidder of bidders) {
        const updated = await tx.jobApplication.updateMany({
          where: { ...eligibleBase, created_by_user_id: bidder.id },
          data: { paid: true },
        });
        if (updated.count === 0) continue;

        reports.push(await tx.paymentReport.create({
          data: {
            bidder_id: bidder.id,
            start_date: range.start,
            end_date: range.end,
            applied_count: updated.count,
            processed_by: null,
          },
        }));
      }

      return {
        skipped: false,
        start_date: range.start,
        end_date: range.end,
        reports,
        total_applied: reports.reduce((total, report) => total + report.applied_count, 0),
      };
    }, { timeout: 120_000, maxWait: 15_000 });
  }

  async history(user: AuthUser) {
    const reports = await this.prisma.paymentReport.findMany({
      // Super admins audit every report. A regular admin sees only settlements they processed;
      // those settlements were already constrained to that admin's own workspaces in process().
      where: user.role === 'super_admin' ? undefined : { processed_by: user.id },
      include: { bidder: { select: { username: true } }, processor: { select: { username: true } } },
      orderBy: { processed_at: 'desc' },
    });
    return reports.map((report) => ({ id: report.id, bidder_id: report.bidder_id, bidder_username: report.bidder.username, start_date: report.start_date, end_date: report.end_date, applied_count: report.applied_count, processed_by: report.processor?.username ?? null, processed_at: report.processed_at }));
  }

  private resolvePeriod(period: Partial<Period>) {
    if (!period.start_date && !period.end_date) {
      const previous = previousWeekRange();
      return { start: previous.start, end: previous.end };
    }
    if (!period.start_date || !period.end_date) throw new BadRequestException('start_date and end_date are required');
    const start = toDayStart(period.start_date);
    const end = toDayStart(period.end_date);
    if (start > end) throw new BadRequestException('start_date must be before or equal to end_date');
    return { start, end };
  }
}
