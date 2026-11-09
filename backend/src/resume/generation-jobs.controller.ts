import { Body, Controller, Get, Header, Headers, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireResumeBuilderVersion } from '../common/decorators/resume-builder-version.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { AnswerApplicationQuestionsDto, GenerateApplicationDto, GenerateProfilePromptDto } from './dto/generate.dto';
import { GenerationJobsService } from './generation-jobs.service';

@Controller('resume/jobs')
@RequireResumeBuilderVersion()
@UseGuards(RolesGuard)
export class GenerationJobsController {
  constructor(private readonly jobs: GenerationJobsService) {}

  @Post('application')
  @HttpCode(202)
  @Header('Cache-Control', 'private, no-store')
  generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateApplicationDto, @Headers('x-generation-id') id?: string) {
    return this.jobs.submit(user, 'application', dto, id);
  }

  @Post('profile')
  @HttpCode(202)
  @Header('Cache-Control', 'private, no-store')
  profile(@CurrentUser() user: AuthUser, @Body() dto: GenerateProfilePromptDto, @Headers('x-generation-id') id?: string) {
    return this.jobs.submit(user, 'profile', dto, id);
  }

  @Post('answers')
  @HttpCode(202)
  @Header('Cache-Control', 'private, no-store')
  answers(@CurrentUser() user: AuthUser, @Body() dto: AnswerApplicationQuestionsDto, @Headers('x-generation-id') id?: string) {
    return this.jobs.submit(user, 'answers', dto, id);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.get(user, id);
  }
}
