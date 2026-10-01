import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApplicationsService } from './applications.service';
import {
  BulkIdsDto, BulkUpdateApplicationsDto, CreateGeneratedApplicationDto, CreateManualApplicationDto,
  QueryApplicationsDto,
  UpdateApplicationDto, UpdatePipelineDto,
} from './dto/application.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import {
  APPLICATION_STATUSES, APPLICATION_STATUS_COLORS, JOB_SOURCES, PIPELINE_STATUSES,
} from '../common/constants';
import { BannedUrlService } from './banned-url.service';
import { CreateBannedUrlPatternDto } from './dto/banned-url.dto';
import { ApplicationGenerationService } from '../resume/resume.service';
import { GenerateApplicationDto } from '../resume/dto/generate.dto';

@Controller('applications')
@UseGuards(RolesGuard)
export class ApplicationsController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly bannedUrls: BannedUrlService,
    private readonly generation: ApplicationGenerationService,
  ) {}

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

  @Post()
  createManual(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateManualApplicationDto,
  ) {
    return this.applications.createManual(user, dto);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthUser, @Query('workspace_id') workspaceId: string) {
    return this.applications.summary(user, workspaceId);
  }

  // Static routes must precede ':id' so they are not captured as an id.
  @Post('generated')
  createGenerated(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateGeneratedApplicationDto,
  ) {
    return this.applications.createGenerated(user, dto);
  }

  /** Canonical application workflow endpoint. `/resume/generate` remains a compatibility alias. */
  @Post('generate')
  generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateApplicationDto) {
    return this.generation.generate(user, dto);
  }

  @Get(':id/resume')
  getResume(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.applications.getResume(user, id);
  }

  @Get('banned-patterns')
  @Roles('admin', 'super_admin')
  bannedPatterns() {
    return this.bannedUrls.list();
  }

  @Post('banned-patterns')
  @Roles('admin', 'super_admin')
  createBannedPattern(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateBannedUrlPatternDto,
  ) {
    return this.bannedUrls.create(dto.pattern, user.id);
  }

  @Delete('banned-patterns/:patternId')
  @Roles('admin', 'super_admin')
  removeBannedPattern(@Param('patternId') patternId: string) {
    return this.bannedUrls.remove(patternId);
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
