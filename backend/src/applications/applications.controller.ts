import {
  Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApplicationsService } from './applications.service';
import {
  BulkIdsDto, BulkUpdateApplicationsDto, CreateFromUrlsDto, QueryApplicationsDto,
  UpdateApplicationDto, UpdatePipelineDto,
} from './dto/application.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import {
  APPLICATION_STATUSES, APPLICATION_STATUS_COLORS, JOB_SOURCES, PIPELINE_STATUSES,
} from '../common/constants';

@Controller('applications')
@UseGuards(RolesGuard)
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  /** Enum catalogue so the frontend never hardcodes a list that could drift from the backend. */
  @Get('meta')
  meta() {
    return {
      application_statuses: APPLICATION_STATUSES,
      application_status_colors: APPLICATION_STATUS_COLORS,
      pipeline_statuses: PIPELINE_STATUSES,
      job_sources: JOB_SOURCES,
    };
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query() query: QueryApplicationsDto) {
    return this.applications.findAll(user, query);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthUser, @Query('workspace_id') workspaceId: string) {
    return this.applications.summary(user, workspaceId);
  }

  // Static routes must precede ':id' so they are not captured as an id.
  @Post('urls')
  createFromUrls(@CurrentUser() user: AuthUser, @Body() dto: CreateFromUrlsDto) {
    return this.applications.createFromUrls(user, dto);
  }

  @Post('urls/preview')
  @HttpCode(200)
  previewUrls(
    @CurrentUser() user: AuthUser,
    @Body() body: { workspace_id: string; urls: string },
  ) {
    return this.applications.previewUrls(user, body.workspace_id, body.urls ?? '');
  }

  @Patch('bulk')
  bulkUpdate(@CurrentUser() user: AuthUser, @Body() dto: BulkUpdateApplicationsDto) {
    return this.applications.bulkUpdate(user, dto);
  }

  @Post('bulk-delete')
  @HttpCode(200)
  bulkDelete(@CurrentUser() user: AuthUser, @Body() dto: BulkIdsDto) {
    return this.applications.bulkDelete(user, dto);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.applications.findOne(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateApplicationDto,
  ) {
    return this.applications.update(user, id, dto);
  }

  @Patch(':id/pipeline')
  @Roles('admin', 'super_admin')
  updatePipeline(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdatePipelineDto,
  ) {
    return this.applications.updatePipeline(user, id, dto);
  }
}
