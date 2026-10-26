import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res, UploadedFile,
  UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
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
import { ApplicationScreenshotService } from './application-screenshot.service';
import { ApplicationDraftService } from './application-draft.service';

@Controller('applications')
@UseGuards(RolesGuard)
export class ApplicationsController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly bannedUrls: BannedUrlService,
    private readonly generation: ApplicationGenerationService,
    private readonly screenshots: ApplicationScreenshotService,
    private readonly drafts: ApplicationDraftService,
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

  @Get('latest-generated')
  latestGenerated(@CurrentUser() user: AuthUser, @Query('workspace_id') workspaceId: string) {
    return this.applications.getLatestGenerated(user, workspaceId);
  }

  // Static routes must precede ':id' so they are not captured as an id.
  @Post('generated')
  createGenerated(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateGeneratedApplicationDto,
  ) {
    throw new BadRequestException('Generate a prepared job and capture its submission screenshot to add the application.');
  }

  @Get('drafts/latest')
  latestDraft(@CurrentUser() user: AuthUser, @Query('workspace_id') workspaceId: string) {
    return this.drafts.latest(user, workspaceId);
  }

  @Post('drafts/:draftId/submit')
  @UseInterceptors(FileInterceptor('screenshot', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  submitDraft(@CurrentUser() user: AuthUser, @Param('draftId') draftId: string,
    @Body('submitted') submitted: string, @UploadedFile() file?: Express.Multer.File) {
    return this.drafts.submit(user, draftId, file, submitted === 'true');
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

  @Post(':id/screenshot')
  @UseInterceptors(FileInterceptor('screenshot', {
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  }))
  uploadScreenshot(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.screenshots.save(user, id, file);
  }

  @Get(':id/screenshot')
  async getScreenshot(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    const screenshot = await this.screenshots.get(user, id);
    response.set({
      'Content-Type': screenshot.content_type,
      'Content-Length': screenshot.image_data.length.toString(),
      'Cache-Control': 'private, no-store',
      'X-Screenshot-Captured-At': screenshot.captured_at.toISOString(),
      'X-Screenshot-Expires-At': screenshot.expires_at.toISOString(),
    });
    response.send(screenshot.image_data);
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
