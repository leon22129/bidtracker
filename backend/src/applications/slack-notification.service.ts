import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { todayUtc } from '../common/utils/date.util';

const MILESTONE_SIZE = 10;

@Injectable()
export class SlackNotificationService {
  private readonly logger = new Logger(SlackNotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Application persistence has already committed; Slack can never make that write fail. */
  async notifyApplicationCreated(userId: string): Promise<void> {
    try {
      await this.sendMilestoneIfDue(userId);
    } catch (error) {
      const message = error instanceof Error
        ? error.message.replace(/https:\/\/hooks\.slack\.com\/services\/\S+/gi, '[redacted Slack webhook]')
        : 'Unknown Slack error';
      this.logger.error(`Slack milestone notification failed for user ${userId}: ${message}`);
    }
  }

  private async sendMilestoneIfDue(userId: string): Promise<void> {
    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        role: true,
        slack_webhook_url: true,
        slack_user_id: true,
        creator: {
          select: {
            id: true,
            role: true,
            slack_webhook_url: true,
            slack_user_id: true,
          },
        },
      },
    });
    if (!actor) return;
    const config = ['admin', 'super_admin'].includes(actor.role)
      ? actor
      : actor.creator;
    if (
      !config ||
      !['admin', 'super_admin'].includes(config.role) ||
      !config.slack_webhook_url
    ) return;

    const day = todayUtc();
    const tomorrow = new Date(day.getTime() + 86_400_000);
    const applicationWhere = {
      created_by_user_id: actor.id,
      application_status: 'Applied',
      created_at: { gte: day, lt: tomorrow },
    };
    const total = await this.prisma.jobApplication.count({ where: applicationWhere });
    const milestone = Math.floor(total / MILESTONE_SIZE) * MILESTONE_SIZE;
    if (milestone < MILESTONE_SIZE) return;

    // The conditional update is the durable, cross-process claim. PostgreSQL rechecks the predicate
    // after a concurrent updater releases its row lock, so only one request can claim a milestone.
    const claim = await this.prisma.user.updateMany({
      where: {
        id: actor.id,
        OR: [
          { slack_milestone_day: null },
          { slack_milestone_day: { lt: day } },
          { slack_milestone_day: { gt: day } },
          {
            slack_milestone_day: day,
            slack_last_milestone: { lt: milestone },
          },
        ],
      },
      data: {
        slack_milestone_day: day,
        slack_last_milestone: milestone,
      },
    });
    if (claim.count === 0) return;

    const grouped = await this.prisma.jobApplication.groupBy({
      by: ['workspace_id'],
      where: applicationWhere,
      _count: { _all: true },
    });
    const workspaces = await this.prisma.workspace.findMany({
      where: { id: { in: grouped.map((row) => row.workspace_id) } },
      select: { id: true, name: true, resumeProfile: { select: { name: true } } },
    });
    const profileNameByWorkspace = new Map(workspaces.map((workspace) => [
      workspace.id,
      workspace.resumeProfile?.name || workspace.name,
    ]));
    const breakdown = new Map<string, number>();
    for (const row of grouped) {
      const name = profileNameByWorkspace.get(row.workspace_id) ?? 'Unknown profile';
      breakdown.set(name, (breakdown.get(name) ?? 0) + row._count._all);
    }
    const breakdownText = [...breakdown.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => `${name}: ${count}`)
      .join(' • ');
    const bidderName = actor.username.replace(/[<>&]/g, '');
    const bidderLabel = actor.slack_user_id && /^[UW][A-Z0-9]+$/.test(actor.slack_user_id)
      ? `<@${actor.slack_user_id}>`
      : `@${bidderName}`;
    const text = `${total} applications received today with ${bidderLabel}.` +
      (breakdownText ? `\n• ${breakdownText}` : '');

    const response = await fetch(config.slack_webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Slack returned HTTP ${response.status}`);
  }
}
