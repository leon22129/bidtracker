import { Body, Controller, Delete, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UpdateAiSettingsDto, UpdateResumePromptDto } from './ai-settings.dto';
import { AiSettingsService } from './ai-settings.service';

@Controller('ai-settings')
@UseGuards(RolesGuard)
@Roles('admin', 'super_admin')
export class AiSettingsController {
  constructor(private readonly settings: AiSettingsService) {}
  @Get()
  get(@CurrentUser() user: AuthUser) { return this.settings.get(user); }
  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateAiSettingsDto) { return this.settings.update(user, dto); }
  @Patch('resume-prompt')
  updateResumePrompt(@CurrentUser() user: AuthUser, @Body() dto: UpdateResumePromptDto) {
    return this.settings.updateResumePrompt(user, dto.resume_prompt);
  }
}

@Controller('workspaces/:workspaceId/ai-settings')
@UseGuards(RolesGuard)
@Roles('admin', 'super_admin')
export class ProfileAiSettingsController {
  constructor(private readonly settings: AiSettingsService) {}
  @Get()
  get(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string) {
    return this.settings.getProfile(user, workspaceId);
  }
  @Patch()
  update(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Body() dto: UpdateAiSettingsDto) {
    return this.settings.updateProfile(user, workspaceId, dto);
  }
  @Delete()
  reset(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string) {
    return this.settings.resetProfile(user, workspaceId);
  }
}
