import { Controller, Get, NotFoundException, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { AnalyticsQueryDto } from './dto/analytics.dto';

@Controller('analytics')
@UseGuards(RolesGuard)
@Roles('admin', 'super_admin')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly access: WorkspaceAccessService,
  ) {}

  private async scope(user: AuthUser, range: { from?: string; to?: string; workspace_id?: string }) {
    const workspaceIds = await this.access.visibleWorkspaceIds(user);
    if (workspaceIds === null) return range;
    if (range.workspace_id && !workspaceIds.includes(range.workspace_id)) {
      throw new NotFoundException('Workspace not found');
    }
    return range.workspace_id ? range : { ...range, workspace_ids: workspaceIds };
  }

  @Get('overview')
  overview(
    @CurrentUser() user: AuthUser,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.scope(user, query).then((range) => this.analytics.overview(range));
  }

  @Get('conversion')
  conversion(@CurrentUser() user: AuthUser, @Query() query: AnalyticsQueryDto) {
    return this.scope(user, query).then((range) => this.analytics.conversion(range));
  }

  @Get('interviews-by-workspace')
  byWorkspace(@CurrentUser() user: AuthUser, @Query() query: AnalyticsQueryDto) {
    return this.scope(user, query).then((range) => this.analytics.interviewsByWorkspace(range));
  }

  @Get('interviews-by-source')
  bySource(@CurrentUser() user: AuthUser, @Query() query: AnalyticsQueryDto) {
    return this.scope(user, query).then((range) => this.analytics.interviewsBySource(range));
  }

  @Get('upcoming-interviews')
  upcomingInterviews(@CurrentUser() user: AuthUser, @Query() query: AnalyticsQueryDto) {
    return this.scope(user, query).then((range) => this.analytics.upcomingInterviews(range));
  }

  @Get('pipeline')
  pipeline(@CurrentUser() user: AuthUser, @Query() query: AnalyticsQueryDto) {
    return this.scope(user, query).then((range) => this.analytics.pipelineBreakdown(range));
  }

}
