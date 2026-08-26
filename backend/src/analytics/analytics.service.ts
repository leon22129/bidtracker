import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  INTERVIEW_PIPELINE_STAGES, OFFER_PIPELINE_STAGES, PIPELINE_STATUSES,
} from '../common/constants';
import { endOfDay, toDayStart } from '../common/utils/date.util';

interface RangeFilter {
  from?: string;
  to?: string;
  workspace_id?: string;
  workspace_ids?: string[];
}

/** Row counts keyed by each status column, for one filter range. */
interface StatusCounts {
  application: Map<string, number>;
  pipeline: Map<string, number>;
}

/**
 * Read-only aggregation for the admin dashboard.
 *
 * "An interview happened" is defined as `pipeline_status ∈ {Recruiter, Technical, Final}` — the
 * pipeline is a furthest-stage-reached field, so an application currently at `Offer Received` did have
 * interviews but is counted as an offer, not an interview. That is the honest reading of a single
 * status column; per-stage history would need an events table (roadmap Phase 9).
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private dateWhere(range: RangeFilter) {
    return {
      ...(range.workspace_id
        ? { workspace_id: range.workspace_id }
        : range.workspace_ids ? { workspace_id: { in: range.workspace_ids } } : {}),
      ...(range.from || range.to
        ? {
            date: {
              ...(range.from ? { gte: toDayStart(range.from) } : {}),
              ...(range.to ? { lte: endOfDay(toDayStart(range.to)) } : {}),
            },
          }
        : {}),
    };
  }

  /** Interview count per workspace (the "John Applications: 12" table). */
  async interviewsByWorkspace(range: RangeFilter = {}) {
    const grouped = await this.prisma.jobApplication.groupBy({
      by: ['workspace_id'],
      where: { ...this.dateWhere(range), pipeline_status: { in: INTERVIEW_PIPELINE_STAGES } },
      _count: { _all: true },
    });

    const workspaces = await this.prisma.workspace.findMany({
      include: { owner: { select: { username: true } } },
    });
    const byId = new Map(workspaces.map((w) => [w.id, w]));

    return grouped
      .map((g) => {
        const workspace = byId.get(g.workspace_id);
        return {
          workspace_id: g.workspace_id,
          workspace_name: workspace?.name ?? '(deleted)',
          owner_username: workspace?.owner.username ?? '—',
          interviews: g._count._all,
        };
      })
      .sort((a, b) => b.interviews - a.interviews);
  }

  /** Interview count per job platform (the "Greenhouse: 20" table). */
  async interviewsBySource(range: RangeFilter = {}) {
    const [interviews, applied] = await Promise.all([
      this.prisma.jobApplication.groupBy({
        by: ['job_source'],
        where: { ...this.dateWhere(range), pipeline_status: { in: INTERVIEW_PIPELINE_STAGES } },
        _count: { _all: true },
      }),
      this.prisma.jobApplication.groupBy({
        by: ['job_source'],
        where: { ...this.dateWhere(range), application_status: 'Applied' },
        _count: { _all: true },
      }),
    ]);

    const appliedBySource = new Map(applied.map((a) => [a.job_source, a._count._all]));

    return interviews
      .map((i) => {
        const appliedCount = appliedBySource.get(i.job_source) ?? 0;
        return {
          job_source: i.job_source,
          interviews: i._count._all,
          applied: appliedCount,
          // Which platform is actually worth bidding on — the reason this table exists.
          interview_rate: appliedCount > 0 ? i._count._all / appliedCount : null,
        };
      })
      .sort((a, b) => b.interviews - a.interviews);
  }

  /**
   * One GROUP BY per status column. Everything on the dashboard except the daily trend and the
   * upcoming-interview list is arithmetic over these two maps, so the whole page costs two index scans.
   */
  private async statusCounts(range: RangeFilter) {
    const where = this.dateWhere(range);
    const [byApplication, byPipeline] = await Promise.all([
      this.prisma.jobApplication.groupBy({
        by: ['application_status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.jobApplication.groupBy({
        by: ['pipeline_status'],
        where,
        _count: { _all: true },
      }),
    ]);
    return {
      application: new Map(byApplication.map((g) => [g.application_status, g._count._all])),
      pipeline: new Map(byPipeline.map((g) => [g.pipeline_status, g._count._all])),
    };
  }

  /**
   * Funnel totals + conversion rates.
   *
   * Every number comes from two GROUP BY scans rather than eight COUNT queries. The naive version
   * measured ~570 ms on a 150,000-row database because SQLite serialises work on a single connection,
   * so `Promise.all` over eight counts is eight sequential scans, not eight concurrent ones.
   *
   * `counts` is passed in by `overview()`, which already has them; a direct caller omits it.
   */
  async conversion(range: RangeFilter = {}, counts?: StatusCounts) {
    const { application: appCounts, pipeline: pipeCounts } =
      counts ?? (await this.statusCounts(range));
    const sum = (map: Map<string, number>, keys: readonly string[]) =>
      keys.reduce((acc, k) => acc + (map.get(k) ?? 0), 0);

    const pending = appCounts.get('Pending') ?? 0;
    const applied = appCounts.get('Applied') ?? 0;
    const rejected = appCounts.get('Rejected') ?? 0;
    const duplicated = appCounts.get('Duplicated') ?? 0;
    const total = pending + applied + rejected + duplicated;
    const interviews = sum(pipeCounts, INTERVIEW_PIPELINE_STAGES);
    const offers = sum(pipeCounts, OFFER_PIPELINE_STAGES);
    const accepted = pipeCounts.get('Accepted') ?? 0;

    return {
      total_applications: total,
      pending_count: pending,
      applied_count: applied,
      rejected_count: rejected,
      duplicated_count: duplicated,
      interview_count: interviews,
      offer_count: offers,
      accepted_count: accepted,
      // Guarded division: a fresh workspace has applied_count = 0 and must not render NaN/Infinity.
      interview_rate: applied > 0 ? interviews / applied : null,
      offer_rate: applied > 0 ? offers / applied : null,
      offer_per_interview_rate: interviews > 0 ? offers / interviews : null,
      duplicate_rate: total > 0 ? duplicated / total : null,
    };
  }

  /** Full pipeline breakdown, always including zero-count stages so the chart axis is stable. */
  async pipelineBreakdown(range: RangeFilter = {}, counts?: StatusCounts) {
    const pipeCounts = (counts ?? (await this.statusCounts(range))).pipeline;
    return PIPELINE_STATUSES.map((stage) => ({
      pipeline_status: stage,
      count: pipeCounts.get(stage) ?? 0,
    }));
  }

  /** Daily applied volume, for the trend sparkline. */
  async dailyVolume(range: RangeFilter = {}) {
    const rows = await this.prisma.jobApplication.groupBy({
      by: ['date'],
      where: { ...this.dateWhere(range), application_status: 'Applied' },
      _count: { _all: true },
      orderBy: { date: 'asc' },
    });
    return rows.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      applied: r._count._all,
    }));
  }

  /** One call for the whole dashboard — avoids six round trips on page load. */
  async overview(range: RangeFilter = {}) {
    // Scanned once and shared: conversion and the pipeline breakdown read the same two groupings.
    const counts = await this.statusCounts(range);
    const [conversion, byWorkspace, bySource, pipeline, daily] = await Promise.all([
      this.conversion(range, counts),
      this.interviewsByWorkspace(range),
      this.interviewsBySource(range),
      this.pipelineBreakdown(range, counts),
      this.dailyVolume(range),
    ]);
    return {
      conversion,
      interviews_by_workspace: byWorkspace,
      interviews_by_source: bySource,
      pipeline_breakdown: pipeline,
      daily_volume: daily,
    };
  }
}
