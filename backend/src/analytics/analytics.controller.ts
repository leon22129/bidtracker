import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

@Controller('analytics')
@UseGuards(RolesGuard)
@Roles('admin')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  overview(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('workspace_id') workspaceId?: string,
  ) {
    return this.analytics.overview({ from, to, workspace_id: workspaceId });
  }

  @Get('conversion')
  conversion(@Query('from') from?: string, @Query('to') to?: string, @Query('workspace_id') w?: string) {
    return this.analytics.conversion({ from, to, workspace_id: w });
  }

  @Get('interviews-by-workspace')
  byWorkspace(@Query('from') from?: string, @Query('to') to?: string) {
    return this.analytics.interviewsByWorkspace({ from, to });
  }

  @Get('interviews-by-source')
  bySource(@Query('from') from?: string, @Query('to') to?: string, @Query('workspace_id') w?: string) {
    return this.analytics.interviewsBySource({ from, to, workspace_id: w });
  }

  @Get('pipeline')
  pipeline(@Query('from') from?: string, @Query('to') to?: string, @Query('workspace_id') w?: string) {
    return this.analytics.pipelineBreakdown({ from, to, workspace_id: w });
  }

}
