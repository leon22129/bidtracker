import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { endOfDay, previousWeekRange, toDayStart } from '../common/utils/date.util';

type Period = { start_date: string; end_date: string; bidder_id?: string };

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async report(user: AuthUser, period: Partial<Period> = {}) {
    const range = this.resolvePeriod(period);
    const bidderIds = await this.visibleBidderIds(user);
    const rows = await this.prisma.jobApplication.findMany({
      where: {
        application_status: 'Applied',
        paid: false,
        date: { gte: range.start, lte: endOfDay(range.end) },
        ...(bidderIds ? { workspace: { owner_user_id: { in: bidderIds } } } : {}),
      },
      select: { workspace: { select: { id: true, name: true, owner_user_id: true, owner: { select: { username: true } } } } },
    });

    const bidders = new Map<string, { bidder_id: string; bidder_username: string; applied_count: number; workspaces: Array<{ workspace_id: string; workspace_name: string; applied_count: number }> }>();
    for (const row of rows) {
      const workspace = row.workspace;
      const bidder = bidders.get(workspace.owner_user_id) ?? { bidder_id: workspace.owner_user_id, bidder_username: workspace.owner.username, applied_count: 0, workspaces: [] };
      bidder.applied_count += 1;
      const workspaceRow = bidder.workspaces.find((item) => item.workspace_id === workspace.id);
      if (workspaceRow) workspaceRow.applied_count += 1;
      else bidder.workspaces.push({ workspace_id: workspace.id, workspace_name: workspace.name, applied_count: 1 });
      bidders.set(workspace.owner_user_id, bidder);
    }
    return { start_date: range.start, end_date: range.end, bidders: [...bidders.values()].sort((a, b) => b.applied_count - a.applied_count), total_applied: rows.length };
  }

  async process(user: AuthUser, period: Period) {
    if (user.role !== 'admin') throw new ForbiddenException('Only an admin can process payment');
    if (!period.bidder_id) throw new BadRequestException('bidder_id is required');
    const range = this.resolvePeriod(period);
    const result = await this.prisma.$transaction(async (tx) => {
      const applications = await tx.jobApplication.findMany({
        where: { application_status: 'Applied', paid: false, date: { gte: range.start, lte: endOfDay(range.end) }, workspace: { owner_user_id: period.bidder_id } },
        select: { id: true },
      });
      const report = await tx.paymentReport.create({
        data: { bidder_id: period.bidder_id!, start_date: range.start, end_date: range.end, applied_count: applications.length, processed_by: user.id },
      });
      if (applications.length) await tx.jobApplication.updateMany({ where: { id: { in: applications.map((application) => application.id) } }, data: { paid: true } });
      return report;
    });
    return { id: result.id, bidder_id: result.bidder_id, start_date: result.start_date, end_date: result.end_date, applied_count: result.applied_count, processed_at: result.processed_at };
  }

  async history(user: AuthUser) {
    const bidderIds = await this.visibleBidderIds(user);
    const reports = await this.prisma.paymentReport.findMany({
      where: bidderIds ? { bidder_id: { in: bidderIds } } : undefined,
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

  private async visibleBidderIds(user: AuthUser): Promise<string[] | null> {
    if (user.role === 'admin') return null;
    const workspaces = await this.prisma.workspace.findMany({ where: { OR: [{ owner_user_id: user.id }, { permissions: { some: { user_id: user.id } } }] }, select: { owner_user_id: true } });
    return [...new Set(workspaces.map((workspace) => workspace.owner_user_id))];
  }
}
